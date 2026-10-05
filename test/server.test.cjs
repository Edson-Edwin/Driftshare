const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const WebSocket = require('ws');
const { createDriftServer } = require('../server');
async function setup(t, code = '4826') {
  const instance = createDriftServer({ accessCode: code });
  instance.server.listen(0, '127.0.0.1'); await once(instance.server, 'listening');
  const port = instance.server.address().port;
  const origin = `http://127.0.0.1:${port}`;
  t.after(async () => { for (const socket of instance.wss.clients) socket.terminate(); await new Promise(resolve => instance.server.close(resolve)); });
  async function peer(name, auth = true) {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`, { origin }); const messages = [];
    ws.on('message', data => messages.push(JSON.parse(data))); await once(ws, 'open');
    ws.messages = messages;
    ws.sendJson = message => ws.send(JSON.stringify(message));
    ws.wait = async (type, predicate = () => true) => {
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) { const index = messages.findIndex(m => m.type === type && predicate(m)); if (index !== -1) return messages.splice(index, 1)[0]; await new Promise(resolve => setTimeout(resolve, 5)); }
      throw new Error(`Timed out waiting for ${type}`);
    };
    if (auth) { ws.sendJson({ type: 'hello', name, code: instance.accessCode }); ws.id = (await ws.wait('welcome')).id; }
    return ws;
  }
  return { ...instance, origin, port, peer };
}
const pause = () => new Promise(resolve => setTimeout(resolve, 40));
const offer = (a, b, transferId = 'transfer123') => a.sendJson({ type: 'file-offer', transferId, targetId: b.id, name: 'a.bin', size: 10, mime: 'application/octet-stream' });
test('malformed JSON values and wrong field types cannot crash signaling', async t => {
  const s = await setup(t); const a = await s.peer('A', false);
  for (const message of ['null', '{}', '[]', '{', '{"type":"hello","name":123,"code":"4826"}']) a.send(message);
  a.sendJson({ type: 'hello', name: 'Valid', code: '4826' });
  assert.ok((await a.wait('welcome')).id);
});
test('private join authentication gates discovery and offers', async t => {
  const s = await setup(t); const a = await s.peer('A'); const stranger = await s.peer('Unknown', false);
  stranger.sendJson({ type: 'hello', name: 'Unknown', code: 'wrong' }); await stranger.wait('auth-required');
  offer(stranger, a); await pause(); assert.equal(s.transfers.size, 0); assert.equal(s.peers.size, 1);
  const response = await fetch(`${s.origin}/join-qr.svg`); assert.equal(response.status, 401);
});
test('duplicate transfer IDs cannot replace ownership; third peers cannot cancel', async t => {
  const s = await setup(t); const a = await s.peer('A'), b = await s.peer('B'), c = await s.peer('C');
  offer(a, b); await b.wait('file-offer'); offer(c, b);
  c.sendJson({ type: 'file-cancel', transferId: 'transfer123' });
  b.sendJson({ type: 'file-accept', transferId: 'transfer123', targetId: a.id });
  await a.wait('file-accept'); assert.equal(s.transfers.get('transfer123').senderId, a.id);
});
test('negotiation requires acceptance and completion requires the recipient', async t => {
  const s = await setup(t); const a = await s.peer('A'), b = await s.peer('B');
  offer(a, b); await b.wait('file-offer');
  const signal = { type: 'rtc-signal', transferId: 'transfer123', targetId: b.id, signal: { type: 'sdp', description: { type: 'offer', sdp: 'test' } } };
  a.sendJson(signal); await pause(); assert.equal(b.messages.some(m => m.type === 'rtc-signal'), false);
  b.sendJson({ type: 'file-accept', transferId: 'transfer123', targetId: a.id }); await a.wait('file-accept');
  a.sendJson(signal); await b.wait('rtc-signal');
  a.sendJson({ type: 'file-received', transferId: 'transfer123', targetId: b.id }); await pause(); assert.equal(s.transfers.size, 1);
  b.sendJson({ type: 'file-received', transferId: 'transfer123', targetId: a.id }); await a.wait('file-received'); assert.equal(s.transfers.size, 0);
});
test('invalid IDs and oversized metadata are ignored', async t => {
  const s = await setup(t); const a = await s.peer('A'), b = await s.peer('B');
  offer(a, b, 'x" onmouseover="alert(1)');
  a.sendJson({ type: 'file-offer', transferId: 'bad-size1', targetId: b.id, name: 'a', size: -10, mime: '' });
  await pause(); assert.equal(s.transfers.size, 0);
});
test('disconnect fails outstanding transfers and clears server state', async t => {
  const s = await setup(t); const a = await s.peer('A'), b = await s.peer('B'); offer(a, b); await b.wait('file-offer');
  a.close(); const message = await b.wait('file-error'); assert.match(message.reason, /disconnected/); assert.equal(s.transfers.size, 0);
});
test('cross-origin WebSocket upgrades are rejected', async t => {
  const s = await setup(t);
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}`, { origin: 'http://untrusted.example' });
  const [error] = await once(ws, 'error'); assert.match(error.message, /403/);
});
test('static UI has security headers and shared protocol', async t => {
  const s = await setup(t); const response = await fetch(s.origin);
  assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/);
  assert.match(await response.text(), /protocol.js/);
});
test('oversized signaling frames close only the offending socket', async t => {
  const s = await setup(t); const a = await s.peer('A');
  const closed = once(a, 'close'); a.send('x'.repeat(70 * 1024));
  const [code] = await closed; assert.equal(code, 1009);
  const b = await s.peer('Still online'); assert.ok(b.id);
});
test('offer flood is bounded per recipient', async t => {
  const s = await setup(t); const a = await s.peer('A'), b = await s.peer('B');
  for (let index = 0; index < 9; index++) offer(a, b, `transfer-${index}`);
  await a.wait('file-error', msg => msg.transferId === 'transfer-8'); assert.equal(s.transfers.size, 8);
});

test('generated codes contain exactly four digits and appear in join links', async t => {
  const s = await setup(t, null);
  assert.match(s.accessCode, /^[1-9][0-9]{3}$/);
  assert.equal(new URLSearchParams(new URL(s.joinUrls()[0]).hash.slice(1)).get('code'), s.accessCode);
  assert.ok((await s.peer('Numeric code')).id);
});
test('configured codes enforce four digits, including leading zeroes', async t => {
  for (const accessCode of ['123', '12345', 'abcd', '', 1234]) assert.throws(() => createDriftServer({ accessCode }), /exactly 4 digits/);
  const s = await setup(t, '0123'); assert.ok((await s.peer('Leading zero')).id);
});
test('wrong-code limits survive reconnects and cover the QR endpoint', async t => {
  const s = await setup(t);
  for (let index = 0; index < 5; index++) {
    const stranger = await s.peer('Guess', false);
    stranger.sendJson({ type: 'hello', name: 'Guess', code: '9999' });
    await stranger.wait('auth-required'); stranger.close();
  }
  const retry = await s.peer('Retry', false);
  retry.sendJson({ type: 'hello', name: 'Retry', code: '4826' });
  assert.equal((await retry.wait('auth-required')).retryAfter, 60);
  const response = await fetch(`${s.origin}/join-qr.svg`, { headers: { Authorization: 'Bearer 4826' } });
  assert.equal(response.status, 429); assert.equal(s.peers.size, 0);
});
test('empty initial hellos do not consume code attempts', async t => {
  const s = await setup(t); const a = await s.peer('Waiting', false);
  for (let index = 0; index < 6; index++) {
    a.sendJson({ type: 'hello', name: 'Waiting', code: '' }); await a.wait('auth-required');
  }
  a.sendJson({ type: 'hello', name: 'Waiting', code: '4826' }); assert.ok((await a.wait('welcome')).id);
});
test('relay streams exact bytes with bounded memory, including the 5 GB boundary', async t => {
  const { Readable, pipeline } = require('node:stream');
  const http = require('node:http');
  const crypto = require('node:crypto');
  const size = Number(process.env.DRIFTSHARE_TEST_BYTES || 4 * 1024 * 1024 + 37);
  assert.ok(size > 0 && size <= 5_000_000_000);
  const s = await setup(t); const a = await s.peer('A'), b = await s.peer('B');
  const transferId = 'relay-test123';
  a.sendJson({ type: 'file-offer', targetId: b.id, transferId, name: 'résumé.bin', size, mime: '' });
  await b.wait('file-offer'); b.sendJson({ type: 'file-accept', targetId: a.id, transferId, transport: 'relay' });
  const ready = await b.wait('relay-ready');
  // Wrong capabilities and HEAD requests cannot claim the one-shot download.
  assert.equal((await fetch(`${s.origin}/relay/${transferId}?token=${'0'.repeat(64)}`)).status, 403);
  assert.equal((await fetch(`${s.origin}${ready.downloadUrl}`, { method: 'HEAD' })).status, 405);
  const baseline = process.memoryUsage().rss; let peak = baseline;
  const sampling = setInterval(() => { peak = Math.max(peak, process.memoryUsage().rss); }, 20); t.after(() => clearInterval(sampling));
  const download = new Promise((resolve, reject) => {
    const request = http.get(`${s.origin}${ready.downloadUrl}`, response => {
      assert.equal(response.headers['content-length'], String(size));
      assert.match(response.headers['content-disposition'], /attachment/);
      const hash = crypto.createHash('sha256'); let bytes = 0;
      response.on('data', chunk => { bytes += chunk.length; hash.update(chunk); });
      response.on('error', reject); response.on('end', () => resolve({ bytes, hash: hash.digest('hex') }));
    }); request.on('error', reject);
  });
  const accept = await a.wait('file-accept'); assert.equal(accept.transport, 'relay');
  const expected = crypto.createHash('sha256');
  const upload = new Promise((resolve, reject) => {
    const request = http.request(`${s.origin}/relay/${transferId}`, { method: 'PUT', headers: { Authorization: `Bearer ${accept.uploadToken}`, 'Content-Length': size } }, response => {
      response.resume(); response.on('end', () => resolve(response.statusCode)); response.on('error', reject);
    }); request.on('error', reject);
    const source = Readable.from((function* () {
      const block = Buffer.alloc(64 * 1024, 0x5a);
      for (let offset = 0; offset < size; offset += block.length) {
        const chunk = block.subarray(0, Math.min(block.length, size - offset)); expected.update(chunk); yield chunk;
      }
    })());
    pipeline(source, request, error => { if (error) reject(error); });
  });
  const [received, status] = await Promise.all([download, upload]);
  assert.equal(status, 200); assert.equal(received.bytes, size); assert.equal(received.hash, expected.digest('hex'));
  await a.wait('relay-complete'); assert.equal(s.transfers.size, 0);
  assert.ok(peak - baseline < 192 * 1024 * 1024, `Unexpected memory growth: ${peak - baseline}`);
  t.diagnostic(`Streamed ${size} bytes; peak RSS growth ${Math.round((peak - baseline) / 1024 / 1024)} MiB.`);
});
test('server rejects offers above 5 GB', async t => {
  const s = await setup(t); const a = await s.peer('A'), b = await s.peer('B');
  a.sendJson({ type: 'file-offer', targetId: b.id, transferId: 'oversized123', name: 'huge.bin', size: 5_000_000_001, mime: '' });
  assert.match((await a.wait('file-error')).reason, /5 GB/); assert.equal(s.transfers.size, 0);
});
async function pendingRelay(s, size = 1024) {
  const a = await s.peer('Sender'), b = await s.peer('Receiver'); const transferId = 'relay-failure123';
  a.sendJson({ type: 'file-offer', targetId: b.id, transferId, name: 'test.bin', size, mime: '' });
  await b.wait('file-offer'); b.sendJson({ type: 'file-accept', targetId: a.id, transferId, transport: 'relay' });
  const ready = await b.wait('relay-ready');
  const download = require('node:http').get(`${s.origin}${ready.downloadUrl}`, response => { response.resume(); response.on('error', () => {}); });
  download.on('error', () => {});
  const accept = await a.wait('file-accept');
  return { a, b, transferId, accept, download };
}
test('relay cancellation aborts the native download and invalidates capabilities', async t => {
  const s = await setup(t); const { a, b, transferId, accept } = await pendingRelay(s);
  b.sendJson({ type: 'file-cancel', transferId }); await a.wait('file-cancel');
  assert.equal(s.transfers.size, 0);
  const response = await fetch(`${s.origin}/relay/${transferId}`, { method: 'PUT', headers: { Authorization: `Bearer ${accept.uploadToken}` }, body: Buffer.alloc(1024) });
  assert.equal(response.status, 403);
});
test('relay rejects an upload whose length differs from the accepted offer', async t => {
  const s = await setup(t); const { a, transferId, accept } = await pendingRelay(s);
  await fetch(`${s.origin}/relay/${transferId}`, { method: 'PUT', headers: { Authorization: `Bearer ${accept.uploadToken}` }, body: Buffer.alloc(5) }).catch(() => {});
  assert.match((await a.wait('file-error')).reason, /length/);
  assert.equal(s.transfers.size, 0); assert.equal(a.messages.some(m => m.type === 'relay-complete'), false);
});
test('a disconnected browser download fails the relay rather than completing it', async t => {
  const s = await setup(t); const { a, download } = await pendingRelay(s);
  download.destroy(); assert.match((await a.wait('file-error')).reason, /interrupted/);
  assert.equal(s.transfers.size, 0); assert.equal(a.messages.some(m => m.type === 'relay-complete'), false);
});

test('either endpoint lacking WebRTC forces consented relay and cannot be overridden by an offer', async t => {
  const s = await setup(t);
  const a = await s.peer('No WebRTC', false), b = await s.peer('Normal');
  a.sendJson({ type: 'hello', name: 'No WebRTC', code: s.accessCode, rtcAvailable: false });
  a.id = (await a.wait('welcome')).id;
  for (const [sender, receiver, transferId] of [[a, b, 'no-rtc-sender'], [b, a, 'no-rtc-receiver']]) {
    sender.sendJson({ type: 'file-offer', targetId: receiver.id, transferId, name: 'a.bin', size: 10, mime: '', rtcAvailable: true });
    assert.equal((await receiver.wait('file-offer')).rtcAvailable, false);
    assert.equal(s.transfers.get(transferId).state, 'offered');
    receiver.sendJson({ type: 'file-accept', transferId, transport: 'rtc' });
    assert.match((await receiver.wait('relay-ready')).downloadUrl, /^\/relay\//);
    receiver.sendJson({ type: 'file-cancel', transferId }); await sender.wait('file-cancel');
  }
});

test('resumable relay continues from the browser offset after disconnect and retains peer identity', async t => {
  const http = require('node:http'); const crypto = require('node:crypto');
  const s = await setup(t); const a = await s.peer('Sender', false), b = await s.peer('Receiver');
  a.sendJson({ type: 'hello', name: 'Sender', code: s.accessCode });
  const welcome = await a.wait('welcome'); a.id = welcome.id;
  const bytes = crypto.randomBytes(512 * 1024 + 37), transferId = 'resumable-range123';
  a.sendJson({ type: 'file-offer', transferId, targetId: b.id, name: 'resumed.bin', size: bytes.length, mime: '' });
  await b.wait('file-offer'); b.sendJson({ type: 'file-accept', transferId, transport: 'relay', resumable: true });
  const { downloadUrl } = await b.wait('relay-ready'); const prefix = [];
  let response;
  const received = new Promise(resolve => {
    http.get(s.origin + downloadUrl, res => {
      response = res; assert.equal(res.headers['accept-ranges'], 'bytes');
      res.on('error', () => {});
      res.on('data', chunk => { prefix.push(chunk); resolve(); });
    }).on('error', () => {});
  });
  const first = await a.wait('file-accept');
  const upload = http.request(`${s.origin}/relay/${transferId}`, { method: 'PUT', headers: { Authorization: `Bearer ${first.uploadToken}`, 'Content-Length': bytes.length } });
  upload.on('error', () => {}); upload.write(bytes.subarray(0, 64 * 1024));
  await received; response.destroy(); await a.wait('relay-paused'); upload.destroy();
  const offset = Buffer.concat(prefix).length;
  assert.ok(offset > 0 && offset < bytes.length); assert.equal(s.transfers.size, 1);
  a.close(); await once(a, 'close');
  const reconnected = await s.peer('Sender', false);
  reconnected.sendJson({ type: 'hello', name: 'Sender', code: s.accessCode, reconnectToken: welcome.reconnectToken });
  assert.equal((await reconnected.wait('welcome')).id, welcome.id);
  assert.equal((await fetch(s.origin + downloadUrl, { headers: { Range: 'bytes=9999999-' } })).status, 416);
  assert.equal((await fetch(s.origin + downloadUrl, { headers: { Range: `bytes=${offset}-`, 'If-Range': '"wrong"' } })).status, 416);
  const resumed = fetch(s.origin + downloadUrl, { headers: { Range: `bytes=${offset}-`, 'If-Range': `"${transferId}"` } });
  const next = await reconnected.wait('file-accept'); assert.equal(next.offset, offset); assert.notEqual(next.uploadToken, first.uploadToken);
  assert.equal((await fetch(`${s.origin}/relay/${transferId}`, { method: 'PUT', headers: { Authorization: `Bearer ${first.uploadToken}` }, body: bytes.subarray(offset) })).status, 403);
  const sending = fetch(`${s.origin}/relay/${transferId}`, { method: 'PUT', headers: { Authorization: `Bearer ${next.uploadToken}` }, body: bytes.subarray(offset) });
  const downloaded = await resumed; assert.equal(downloaded.status, 206);
  assert.equal(downloaded.headers.get('content-range'), `bytes ${offset}-${bytes.length - 1}/${bytes.length}`);
  const full = Buffer.concat([...prefix, Buffer.from(await downloaded.arrayBuffer())]);
  assert.deepEqual(full, bytes); assert.equal((await sending).status, 200);
  await reconnected.wait('relay-complete'); assert.equal(s.transfers.size, 0);
});
