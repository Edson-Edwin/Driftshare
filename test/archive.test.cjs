const { test } = require('node:test');
const assert = require('node:assert/strict');
const A = require('../public/archive');
const P = require('../public/protocol');
test('stored ZIP preserves nested UTF-8 paths and CRCs including empty files', async () => {
  const file = new File(['hello world'], 'hello.txt'); Object.defineProperty(file, 'webkitRelativePath', { value: 'folder/nested/हेलो.txt' });
  const archive = await A.create([file, new File([], 'empty.txt')]);
  const bytes = Buffer.from(await archive.arrayBuffer()); let at = 0;
  for (const [name, expected] of [['folder/nested/हेलो.txt', 'hello world'], ['empty.txt', '']]) {
    assert.equal(bytes.readUInt32LE(at), 0x04034b50); assert.equal(bytes.readUInt16LE(at + 8), 0);
    const length = bytes.readUInt32LE(at + 18), n = bytes.readUInt16LE(at + 26), extra = bytes.readUInt16LE(at + 28);
    assert.equal(bytes.subarray(at + 30, at + 30 + n).toString(), name);
    const body = bytes.subarray(at + 30 + n + extra, at + 30 + n + extra + length);
    assert.equal(body.toString(), expected); assert.equal(bytes.readUInt32LE(at + 14), (P.checksum(0xffffffff, body) ^ 0xffffffff) >>> 0);
    at += 30 + n + extra + length;
  }
  assert.equal(bytes.readUInt32LE(at), 0x02014b50); assert.equal(bytes.readUInt32LE(bytes.length - 22), 0x06054b50);
  assert.equal(bytes.readUInt32LE(bytes.length - 6), at);
});
test('archives reject traversal, Windows-invalid paths, duplicates and oversized input before reading', async () => {
  for (const name of ['../secret', '/root', 'a/../b', 'a\\b', 'CON.txt', 'a:stream', 'x.']) assert.throws(() => A.pathName(name));
  await assert.rejects(A.create([new File([], 'a'), new File([], 'A')]), /Duplicate/);
  await assert.rejects(A.create([{ name: 'huge', size: P.MAX_FILE, slice() { throw Error('Must not read'); } }]), /exceed 5 GB/);
});
test('ZIP preparation can be cancelled', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(A.create([new File(['test'], 'test.txt')], { signal: controller.signal }), { name: 'AbortError' });
});
