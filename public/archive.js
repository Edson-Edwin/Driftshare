/* ZIP/ZIP64 in store mode: CRCs are read incrementally; payloads stay Blob parts.
   Folder paths are retained without compression or whole-folder ArrayBuffers. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./protocol'));
  else root.DriftArchive = factory(root.DriftProtocol);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (P) {
  const encoder = new TextEncoder(), U32 = 0xffffffff;
  function record(size) {
    const bytes = new Uint8Array(size), view = new DataView(bytes.buffer);
    return { bytes, u16: (at, n) => view.setUint16(at, n, true), u32: (at, n) => view.setUint32(at, n, true), u64: (at, n) => view.setBigUint64(at, BigInt(n), true) };
  }
  function pathName(value) {
    if (typeof value !== 'string' || !value || encoder.encode(value).length > 1024 ||
        value.split('/').some(part => !part || part === '.' || part === '..' || /[\\<>:"|?*\x00-\x1f]/.test(part) || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) {
      throw new Error('A folder path is unsafe or not portable to Windows. Rename it and try again.');
    }
    return value;
  }
  async function create(files, { name = 'DriftShare-files.zip', signal, onProgress = () => {} } = {}) {
    if (!files.length || files.length > 1000) throw new Error('Choose between 1 and 1,000 files per archive.');
    let total = 0; const seen = new Set();
    const entries = files.map(file => {
      const path = pathName(file.webkitRelativePath || file.name), key = path.normalize('NFC').toLowerCase();
      if (seen.has(key)) throw new Error('Duplicate folder paths would overwrite each other. Rename them first.');
      seen.add(key); const filename = encoder.encode(path);
      total += file.size;
      return { file, filename };
    });
    // Conservative ZIP64 metadata allowance, checked before reading source files.
    if (total + entries.reduce((sum, e) => sum + 128 + e.filename.length * 2, 98) > P.MAX_FILE) throw new Error('The ZIP would exceed 5 GB. Select a smaller folder or batch.');
    const parts = [], central = []; let offset = 0, processed = 0;
    for (const { file, filename } of entries) {
      let crc = 0xffffffff;
      const stream = file.stream(); let reader, byob = false;
      try { reader = stream.getReader({ mode: 'byob' }); byob = true; }
      catch { reader = stream.getReader(); }
      // Reuse the returned BYOB buffer instead of accumulating disposable payloads
      // until the browser decides to collect external ArrayBuffer memory.
      let buffer = byob ? new ArrayBuffer(64 * 1024) : null;
      try {
        while (true) {
          signal?.throwIfAborted();
          const { value, done } = await (byob ? reader.read(new Uint8Array(buffer)) : reader.read());
          if (done) break;
          if (byob) buffer = value.buffer;
          crc = P.checksum(crc, value); processed += value.length; onProgress(processed, total);
        }
      } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
      signal?.throwIfAborted(); crc = (crc ^ 0xffffffff) >>> 0;
      const large = file.size >= U32, far = offset >= U32;
      const extra = record(large ? 20 : 0);
      if (large) { extra.u16(0, 1); extra.u16(2, 16); extra.u64(4, file.size); extra.u64(12, file.size); }
      const local = record(30); local.u32(0, 0x04034b50); local.u16(4, large ? 45 : 20); local.u16(6, 0x800);
      local.u16(12, 33); // 1980-01-01, deterministic archive metadata.
      local.u32(14, crc); local.u32(18, large ? U32 : file.size); local.u32(22, large ? U32 : file.size);
      local.u16(26, filename.length); local.u16(28, extra.bytes.length);
      parts.push(local.bytes, filename, extra.bytes, file);
      const centralExtra = record(large || far ? 4 + (large ? 16 : 0) + (far ? 8 : 0) : 0);
      if (centralExtra.bytes.length) {
        centralExtra.u16(0, 1); centralExtra.u16(2, centralExtra.bytes.length - 4); let at = 4;
        if (large) { centralExtra.u64(at, file.size); centralExtra.u64(at + 8, file.size); at += 16; }
        if (far) centralExtra.u64(at, offset);
      }
      const c = record(46); c.u32(0, 0x02014b50); c.u16(4, 45); c.u16(6, large || far ? 45 : 20); c.u16(8, 0x800); c.u16(14, 33);
      c.u32(16, crc); c.u32(20, large ? U32 : file.size); c.u32(24, large ? U32 : file.size); c.u16(28, filename.length); c.u16(30, centralExtra.bytes.length); c.u32(42, far ? U32 : offset);
      central.push(c.bytes, filename, centralExtra.bytes); offset += 30 + filename.length + extra.bytes.length + file.size;
    }
    const centralSize = central.reduce((sum, part) => sum + part.length, 0);
    parts.push(...central);
    if (offset >= U32 || centralSize >= U32 || entries.length >= 65535) {
      const end64 = record(56); end64.u32(0, 0x06064b50); end64.u64(4, 44); end64.u16(12, 45); end64.u16(14, 45);
      end64.u64(24, entries.length); end64.u64(32, entries.length); end64.u64(40, centralSize); end64.u64(48, offset);
      const locator = record(20); locator.u32(0, 0x07064b50); locator.u64(8, offset + centralSize); locator.u32(16, 1); parts.push(end64.bytes, locator.bytes);
    }
    const end = record(22); end.u32(0, 0x06054b50); end.u16(8, Math.min(entries.length, 65535)); end.u16(10, Math.min(entries.length, 65535));
    end.u32(12, Math.min(centralSize, U32)); end.u32(16, Math.min(offset, U32)); parts.push(end.bytes);
    signal?.throwIfAborted();
    const result = new File(parts, name, { type: 'application/zip' });
    if (result.size > P.MAX_FILE) throw new Error('The ZIP exceeds 5 GB.');
    return result;
  }
  return { create, pathName };
});
