// Native browser downloads work on LAN HTTP too. This relay pipes bytes straight
// from the sender to the receiver, with bounded stream buffers and no host files.
const { Transform, pipeline } = require('node:stream');
const crypto = require('node:crypto');
const contentDisposition = require('content-disposition');
const P = require('./public/protocol');

function installRelay(app, { transfers, peers, send, finish }) {
  function notify(id, t, type, extra = {}) {
    for (const peerId of [t.senderId, t.receiverId]) send(peers.get(peerId), { type, transferId: id, ...extra });
  }
  function prepare(id, t, resumable = false) {
    t.relay = { uploadToken: crypto.randomBytes(32).toString('hex'), downloadToken: crypto.randomBytes(32).toString('hex'), bytes: 0, resumable, paused: false, attempt: 0 };
    send(peers.get(t.receiverId), { type: 'relay-ready', transferId: id,
      resumable, downloadUrl: `/relay/${id}?token=${t.relay.downloadToken}` });
  }
  function authorized(req, kind) {
    if (!P.validId(req.params.id)) return null;
    const t = transfers.get(req.params.id);
    const token = kind === 'download' ? req.query.token : req.headers.authorization?.replace(/^Bearer /, '');
    if (t?.state !== 'accepted' || !t.relay || typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return null;
    const expected = t.relay[`${kind}Token`];
    if (token.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))) return null;
    return t;
  }
  app.get('/relay/:id', (req, res) => {
    // Express also dispatches HEAD to GET handlers: do not consume a download.
    if (req.method !== 'GET') return res.sendStatus(405);
    const t = authorized(req, 'download');
    if (!t) return res.sendStatus(403);
    if (t.relay.response) return res.status(409).send('Download already started.');
    if (t.relay.resumable && peers.get(t.senderId)?.readyState !== 1) return res.set('Retry-After', '3').status(503).send('Sender reconnecting. Retry this download shortly.');
    let offset = 0;
    const etag = `"${req.params.id}"`;
    if (req.headers.range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range);
      offset = match ? Number(match[1]) : NaN;
      if (!t.relay.resumable || !Number.isSafeInteger(offset) || offset < 0 || offset >= t.size || (match[2] && Number(match[2]) !== t.size - 1) ||
          (req.headers['if-range'] && req.headers['if-range'] !== etag)) {
        return res.set('Content-Range', `bytes */${t.size}`).status(416).end();
      }
      res.status(206).set('Content-Range', `bytes ${offset}-${t.size - 1}/${t.size}`);
    }
    const relay = t.relay;
    relay.attempt++; relay.offset = offset; relay.bytes = offset; relay.paused = false;
    relay.uploadToken = crypto.randomBytes(32).toString('hex');
    relay.response = res; t.at = Date.now();
    if (relay.resumable) res.set({ 'Accept-Ranges': 'bytes', ETag: etag });
    res.set({ 'Content-Type': 'application/octet-stream', 'Content-Length': String(t.size - offset),
      'Content-Disposition': contentDisposition(t.name, { type: 'attachment' }),
      'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
    res.on('close', () => {
      if (!res.writableFinished && transfers.get(req.params.id) === t && t.relay.response === res) interrupted(req.params.id, t);
    });
    res.flushHeaders();
    notify(req.params.id, t, 'relay-progress', { bytes: offset, resumed: true });
    send(peers.get(t.senderId), { type: 'file-accept', transferId: req.params.id, fromId: t.receiverId,
      transport: 'relay', offset, resumable: relay.resumable, uploadToken: t.relay.uploadToken });
  });
  app.put('/relay/:id', (req, res) => {
    const t = authorized(req, 'upload');
    if (!t) return res.sendStatus(403);
    const relay = t.relay;
    if (!relay.response || relay.request) return res.status(409).send('Download is not ready or upload already started.');
    if (req.headers['content-length'] !== String(t.size - relay.offset) || req.headers['content-encoding']) {
      res.status(400).send('File length does not match the offer.');
      finish(req.params.id, 'file-error', 'File length does not match the offer.'); return;
    }
    relay.request = req; relay.uploadResponse = res;
    const attempt = relay.attempt;
    let lastProgress = 0;
    const counter = new Transform({ highWaterMark: 64 * 1024,
      transform(chunk, encoding, callback) {
        relay.bytes += chunk.length;
        if (relay.bytes > t.size) return callback(new Error('Upload exceeded its declared length.'));
        t.at = Date.now();
        if (t.at - lastProgress >= 250) { lastProgress = t.at; notify(req.params.id, t, 'relay-progress', { bytes: relay.bytes }); }
        callback(null, chunk);
      },
      flush(callback) { callback(relay.bytes === t.size ? null : new Error('Upload was truncated.')); }
    });
    pipeline(req, counter, relay.response, error => {
      if (transfers.get(req.params.id) !== t || relay.attempt !== attempt || relay.paused) return;
      if (error) {
        if (!res.destroyed && !res.headersSent) res.status(500).send('Transfer interrupted.');
        interrupted(req.params.id, t);
      } else {
        // Native downloads cannot report their disk commit to the page. Describe
        // precisely what is known: all bytes were sent to the download response.
        res.json({ bytes: relay.bytes });
        finish(req.params.id, 'relay-complete');
      }
    });
  });
  function close(t, success) {
    const relay = t.relay;
    if (!relay || success) return;
    const { request, response, uploadResponse } = relay;
    // Detach before destroying streams: late callbacks cannot affect a resumed attempt.
    relay.attempt++; relay.request = relay.response = relay.uploadResponse = null;
    request?.destroy(); response?.destroy(); uploadResponse?.destroy();
  }
  function interrupted(id, t) {
    if (!t.relay?.resumable) { finish(id, 'file-error', 'Browser download interrupted. Retry the file.'); return; }
    if (t.relay.paused) return;
    t.relay.paused = true; t.at = Date.now(); close(t, false);
    notify(id, t, 'relay-paused', { reason: 'Connection interrupted. Keep both tabs open, reconnect, then use Resume in the receiving browser’s Downloads within 15 minutes.' });
  }
  return { prepare, close, interrupted };

}
module.exports = { installRelay };
