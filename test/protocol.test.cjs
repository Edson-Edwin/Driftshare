const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../public/protocol');
test('CRC32 matches the standard vector and chunked processing', () => {
  const bytes = Buffer.from('123456789');
  assert.equal(P.digest(P.checksum(0xffffffff, bytes)), 'cbf43926');
  const first = P.checksum(0xffffffff, bytes.subarray(0, 4));
  assert.equal(P.digest(P.checksum(first, bytes.subarray(4))), 'cbf43926');
  assert.equal(P.digest(0xffffffff), '00000000');
});
test('transfer metadata rejects injection, noninteger sizes, and oversized names', () => {
  const offer = { transferId: '12345678', targetId: 'abcdefgh', name: 'file.txt', size: 0, mime: '' };
  assert.equal(P.validOffer(offer), true);
  for (const change of [{ transferId: 'x" onclick="bad' }, { size: -1 }, { size: 1.5 }, { size: Number.MAX_SAFE_INTEGER + 1 }, { name: 'x'.repeat(256) }, { name: 'a\0b' }, { mime: {} }, { targetId: null }]) assert.equal(P.validOffer({ ...offer, ...change }), false);
});
test('5 GB files are accepted while oversized files are rejected', () => {
  const offer = { transferId: '12345678', targetId: 'abcdefgh', name: 'big.bin', size: P.MAX_FILE, mime: '' };
  assert.equal(P.MAX_FILE, 5_000_000_000);
  assert.equal(P.validOffer(offer), true);
  assert.equal(P.validOffer({ ...offer, size: P.MAX_FILE + 1 }), false);
});
test('device labels distinguish platforms including modern iPads', () => {
  assert.equal(P.deviceLabel('Mozilla Android Mobile', 'Linux'), 'Android phone');
  assert.equal(P.deviceLabel('Mozilla iPhone', 'iPhone'), 'iPhone');
  assert.equal(P.deviceLabel('Mozilla Macintosh', 'MacIntel', 5), 'iPad');
  assert.equal(P.deviceLabel('Mozilla Windows', 'Win32'), 'Windows PC');
  assert.equal(P.deviceLabel('Mozilla Linux', 'Linux'), 'Linux computer');
});
