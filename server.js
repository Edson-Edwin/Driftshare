const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { WebSocketServer } = require('ws');
const P = require('./public/protocol');
const { installRelay } = require('./relay');
const execFileAsync = promisify(execFile);

function getLanAddresses() {
  return [...new Set(Object.values(os.networkInterfaces()).flat()
    .filter(n => n && n.family === 'IPv4' && !n.internal).map(n => n.address))];
}

function createDriftServer(options = {}) {
  const accessCode = options.accessCode ?? process.env.ACCESS_CODE ?? String(crypto.randomInt(1000, 10000));
  if (typeof accessCode !== 'string' || !/^\d{4}$/.test(accessCode)) throw new Error('ACCESS_CODE must contain exactly 4 digits.');
  const publicUrl = process.env.PUBLIC_URL ? new URL(process.env.PUBLIC_URL) : null;
  if (publicUrl && (!['http:', 'https:'].includes(publicUrl.protocol) || publicUrl.username || publicUrl.password || publicUrl.pathname !== '/')) {
    throw new Error('PUBLIC_URL must be an HTTP(S) origin without credentials or a path.');
  }
  const tlsCert = process.env.TLS_CERT;
  const tlsKey = process.env.TLS_KEY;
  if (!!tlsCert !== !!tlsKey) throw new Error('Set both TLS_CERT and TLS_KEY for HTTPS.');
  const secure = Boolean(tlsCert);
  const app = express();
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    req.setTimeout(90000, () => req.destroy());
    res.set({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
      'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'" });
    next();
  });
  app.use(express.static(path.join(__dirname, 'public')));
  function authenticated(code) {
    if (typeof code !== 'string' || !/^\d{4}$/.test(code)) return false;
    const a = Buffer.from(code), b = Buffer.from(accessCode);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  // Share failed attempts across sockets and the QR endpoint so reconnecting
  // cannot bypass the short-code limit. An empty initial hello is not a guess.
  const failedJoins = new Map();
  function checkAccess(code, ip) {
    const now = Date.now();
    let failures = failedJoins.get(ip);
    if (failures && now - failures.at >= 60000) { failedJoins.delete(ip); failures = null; }
    if (failures?.count >= 5) return 'limited';
    if (authenticated(code)) return 'ok';
    if (code) {
      if (!failures) failedJoins.set(ip, failures = { at: now, count: 0 });
      failures.count++;
    }
    return 'invalid';
  }
  function joinUrls(req) {
    const port = server.address()?.port || process.env.PORT || 4000;
    const roots = publicUrl ? [publicUrl.origin] : getLanAddresses().map(addr => `${secure ? 'https' : 'http'}://${addr}:${port}`);
    if (!roots.length) roots.push(`${secure ? 'https' : 'http'}://localhost:${port}`);
    return roots.map(root => {
      const url = new URL(root);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('PUBLIC_URL must be HTTP(S).');
      url.hash = new URLSearchParams({ code: accessCode }).toString();
      return url.href;
    });
  }
  let qrBusy = false;
  app.get('/join-qr.svg', async (req, res) => {
    const auth = checkAccess(req.headers.authorization?.replace(/^Bearer /, ''), req.socket.remoteAddress);
    if (auth === 'limited') return res.set('Retry-After', '60').sendStatus(429);
    if (auth !== 'ok') return res.sendStatus(401);
    if (qrBusy) return res.status(429).send('Try again shortly.');
    qrBusy = true;
    try {
      const index = Number(req.query.address || 0);
      const url = joinUrls(req)[index];
      if (!url) return res.sendStatus(400);
      const { stdout } = await execFileAsync('qrencode', ['-t', 'SVG', '-o', '-', '-m', '1', url],
        { timeout: 3000, maxBuffer: 1024 * 1024 });
      res.set('Cache-Control', 'no-store').type('image/svg+xml').send(stdout);
    } catch {
      res.status(503).send('QR code unavailable. Copy the join link, or install qrencode on the host.');
    } finally { qrBusy = false; }
  });
  const server = secure ? https.createServer({ cert: fs.readFileSync(tlsCert), key: fs.readFileSync(tlsKey) }, app) : http.createServer(app);
  // A multi-GB upload can take longer than Node's default five-minute deadline.
  // Transfer progress below supplies the inactivity deadline instead.
  server.requestTimeout = 0;
  const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });
  const peers = new Map(), transfers = new Map(), reconnects = new Map();
  const attempts = new Map();
  server.on('upgrade', (req, socket, head) => {
    let validOrigin = false;
    try {
      const origin = new URL(req.headers.origin);
      validOrigin = publicUrl ? origin.origin === publicUrl.origin :
        origin.host === req.headers.host && origin.protocol === `${secure ? 'https' : 'http'}:`;
    } catch { /* reject absent and malformed browser origins */ }
    const ip = req.socket.remoteAddress;
    const now = Date.now();
    let attempt = attempts.get(ip);
    if (!attempt || now - attempt.at > 60000) attempts.set(ip, attempt = { at: now, count: 0 });
    if (!validOrigin || req.url !== '/' || wss.clients.size >= 64 || ++attempt.count > 60) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req));
  });
  function send(ws, message) {
    if (ws?.readyState !== 1) return;
    if (ws.bufferedAmount > 256 * 1024) return ws.terminate();
    ws.send(JSON.stringify(message), () => {});
  }
  function broadcast() {
    const list = [...peers.values()].map(ws => ({ id: ws.id, name: ws.name, deviceType: ws.deviceType }));
    for (const ws of peers.values()) send(ws, { type: 'peers', peers: list.filter(p => p.id !== ws.id) });
  }
  function finish(id, type, reason) {
    const t = transfers.get(id);
    if (!t) return;
    transfers.delete(id);
    relay.close(t, type === 'relay-complete');
    for (const peerId of [t.senderId, t.receiverId]) send(peers.get(peerId), { type, transferId: id, reason });
  }
  const relay = installRelay(app, { transfers, peers, send, finish });
  wss.on('connection', (ws, req) => {
    ws.id = crypto.randomBytes(16).toString('hex');
    ws.isAlive = true;
    ws.authFailures = 0;
    ws.rate = { at: Date.now(), count: 0 };
    const authTimer = setTimeout(() => { if (!peers.has(ws.id)) ws.close(1008, 'Join link required'); }, 60000);
    ws.on('error', () => {}); // malformed frames must only close this connection
    ws.on('pong', () => { ws.isAlive = true; });
    ws.on('message', (data, binary) => {
      if (binary) return ws.close(1003, 'Signaling only');
      if (Date.now() - ws.rate.at > 1000) ws.rate = { at: Date.now(), count: 0 };
      if (++ws.rate.count > 120) return ws.close(1008, 'Too many messages');
      let msg;
      try { msg = JSON.parse(data.toString()); } catch { return; }
      if (!msg || typeof msg !== 'object' || Array.isArray(msg) || typeof msg.type !== 'string') return;
      if (msg.type === 'hello') {
        const auth = checkAccess(msg.code, req.socket.remoteAddress);
        if (auth !== 'ok') {
          send(ws, { type: 'auth-required', retryAfter: auth === 'limited' ? 60 : 0 });
          if (auth === 'limited' || (msg.code && ++ws.authFailures >= 3)) ws.close(1008, 'Invalid join code');
          return;
        }
        if (typeof msg.name !== 'string' || !msg.name.trim()) return;
        if (!peers.has(ws.id)) {
          const previous = typeof msg.reconnectToken === 'string' && reconnects.get(msg.reconnectToken);
          if (previous && Date.now() - previous.at < 15 * 60 * 1000 && !peers.has(previous.id)) {
            ws.id = previous.id; ws.reconnectToken = msg.reconnectToken;
          } else {
            if (reconnects.size >= 128) return ws.close(1008, 'Too many recent devices. Try again later.');
            ws.reconnectToken = crypto.randomBytes(32).toString('hex');
          }
          reconnects.set(ws.reconnectToken, { id: ws.id, at: Date.now() });
        }
        clearTimeout(authTimer);
        ws.name = msg.name.trim().slice(0, 40);
        ws.deviceType = msg.deviceType === 'mobile' ? 'mobile' : 'desktop';
        ws.rtcAvailable = msg.rtcAvailable !== false;
        peers.set(ws.id, ws);
        send(ws, { type: 'welcome', id: ws.id, reconnectToken: ws.reconnectToken, joinUrls: joinUrls(req) });
        broadcast();
        return;
      }
      if (!peers.has(ws.id)) return;
      if (msg.type === 'rename') {
        if (typeof msg.name !== 'string' || !msg.name.trim()) return;
        ws.name = msg.name.trim().slice(0, 40); broadcast(); return;
      }
      if (!P.validId(msg.transferId)) return;
      if (msg.type === 'file-offer') {
        if (Number.isSafeInteger(msg.size) && msg.size > P.MAX_FILE) return send(ws, { type: 'file-error', transferId: msg.transferId, reason: 'Files must be 5 GB or smaller.' });
        if (!P.validOffer(msg)) return;
        // IDs cannot replace an existing transfer, including one owned by this peer.
        if (transfers.has(msg.transferId)) return;
        const target = peers.get(msg.targetId);
        if (!target || target === ws) return send(ws, { type: 'file-error', transferId: msg.transferId, reason: 'Device is offline or invalid.' });
        const occupied = [...transfers.values()].filter(t => [t.senderId, t.receiverId].includes(ws.id)).length;
        const incoming = [...transfers.values()].filter(t => t.receiverId === target.id).length;
        if (occupied >= 8 || incoming >= 8) return send(ws, { type: 'file-error', transferId: msg.transferId, reason: 'Too many pending transfers. Try again shortly.' });
        transfers.set(msg.transferId, { senderId: ws.id, receiverId: target.id, name: msg.name, size: msg.size, rtcAvailable: ws.rtcAvailable && target.rtcAvailable, state: 'offered', at: Date.now() });
        send(target, { type: 'file-offer', transferId: msg.transferId, fromId: ws.id, fromName: ws.name,
          name: msg.name, size: msg.size, mime: msg.mime, rtcAvailable: ws.rtcAvailable && target.rtcAvailable });
        return;
      }
      const t = transfers.get(msg.transferId);
      if (!t || ![t.senderId, t.receiverId].includes(ws.id)) return;
      const otherId = t.senderId === ws.id ? t.receiverId : t.senderId;
      if (msg.targetId !== undefined && msg.targetId !== otherId) return;
      switch (msg.type) {
        case 'file-accept':
          if (ws.id !== t.receiverId || t.state !== 'offered') return;
          t.state = 'accepted'; t.at = Date.now();
          if (msg.transport === 'relay' || !t.rtcAvailable) { relay.prepare(msg.transferId, t, msg.resumable === true); break; }
          send(peers.get(t.senderId), { type: 'file-accept', transferId: msg.transferId, fromId: ws.id });
          break;
        case 'file-reject':
          if (ws.id === t.receiverId && t.state === 'offered') finish(msg.transferId, 'file-reject');
          break;
        case 'rtc-signal': {
          if (t.state !== 'accepted' || t.relay || !msg.signal || typeof msg.signal !== 'object') return;
          const s = msg.signal;
          const valid = s.type === 'sdp' ? s.description && ['offer', 'answer'].includes(s.description.type) &&
            typeof s.description.sdp === 'string' && s.description.sdp.length < 48000 :
            s.type === 'candidate' && s.candidate && typeof s.candidate.candidate === 'string' && s.candidate.candidate.length < 4096;
          if (valid) send(peers.get(otherId), { type: 'rtc-signal', transferId: msg.transferId, fromId: ws.id, signal: s });
          break;
        }
        case 'file-keepalive':
          if (t.state === 'accepted' && !t.relay) t.at = Date.now();
          break;
        case 'file-received':
          if (ws.id === t.receiverId && t.state === 'accepted' && !t.relay) finish(msg.transferId, 'file-received');
          break;
        case 'file-cancel': finish(msg.transferId, 'file-cancel'); break;
        case 'file-error':
          finish(msg.transferId, 'file-error', typeof msg.reason === 'string' ? msg.reason.slice(0, 200) : 'Transfer failed.');
          break;
      }
    });
    ws.on('close', () => {
      clearTimeout(authTimer);
      peers.delete(ws.id);
      const reconnect = reconnects.get(ws.reconnectToken); if (reconnect) reconnect.at = Date.now();
      for (const [id, t] of transfers) if ([t.senderId, t.receiverId].includes(ws.id)) {
        if (t.relay?.resumable) relay.interrupted(id, t);
        else finish(id, 'file-error', 'Device disconnected. Reconnect and retry.');
      }
      broadcast();
    });
  });
  const maintenance = setInterval(() => {
    const now = Date.now();
    for (const ws of wss.clients) {
      if (!ws.isAlive) { ws.terminate(); continue; }
      ws.isAlive = false; ws.ping(() => {});
    }
    for (const [id, t] of transfers) if (now - t.at > (t.relay?.paused ? 15 * 60 * 1000 : t.state === 'offered' ? 120000 : 90000)) finish(id, 'file-error', 'Transfer timed out. Please retry.');
    for (const [token, item] of reconnects) if (!peers.has(item.id) && now - item.at > 15 * 60 * 1000) reconnects.delete(token);
    for (const [ip, item] of attempts) if (now - item.at > 60000) attempts.delete(ip);
    for (const [ip, item] of failedJoins) if (now - item.at >= 60000) failedJoins.delete(ip);
  }, 30000);
  maintenance.unref();
  server.on('close', () => { clearInterval(maintenance); wss.close(); });
  return { server, wss, peers, transfers, accessCode, joinUrls };
}

if (require.main === module) {
  const instance = createDriftServer();
  instance.server.listen(process.env.PORT || 4000, process.env.HOST || '0.0.0.0', () => {
    console.log('\nDriftShare — open a private join link on each device:');
    console.log(`  Join code: ${instance.accessCode}`);
    for (const url of instance.joinUrls()) console.log(`  ${url}`);
    console.log('Files up to 5 GB. Direct WebRTC or streamed LAN-host downloads. Keep join links private.\n');
  });
  instance.server.on('error', error => { console.error(`Could not start DriftShare: ${error.message}`); process.exitCode = 1; });
}
module.exports = { createDriftServer, getLanAddresses };
