/* Shared protocol limits and streaming checksum. CRC32 detects accidental corruption;
   peer authentication and encryption are provided separately. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.DriftProtocol = factory();
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const MAX_MEMORY = 128 * 1024 * 1024;
  const MAX_FILE = 5_000_000_000; // 5 GB per file; memory remains independently bounded.
  const WINDOW = 2 * 1024 * 1024;
  const CHUNK = 64 * 1024;
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  function checksum(state, bytes) {
    for (let i = 0; i < bytes.length; i++) state = table[(state ^ bytes[i]) & 255] ^ (state >>> 8);
    return state >>> 0;
  }
  function digest(state) { return ((state ^ 0xffffffff) >>> 0).toString(16).padStart(8, '0'); }
  function validId(value) { return typeof value === 'string' && /^[a-zA-Z0-9_-]{8,64}$/.test(value); }
  function validOffer(msg) {
    return validId(msg.transferId) && validId(msg.targetId) && typeof msg.name === 'string' &&
      msg.name.length > 0 && msg.name.length <= 255 && !/[\x00-\x1f]/.test(msg.name) &&
      Number.isSafeInteger(msg.size) && msg.size >= 0 && msg.size <= MAX_FILE &&
      typeof msg.mime === 'string' && msg.mime.length <= 128;
  }
  function terminal(status) { return ['done', 'error', 'cancelled', 'rejected'].includes(status); }
  function deviceLabel(userAgent = '', platform = '', touchPoints = 0) {
    if (/iPad/.test(userAgent) || (/Mac/.test(platform) && touchPoints > 1)) return 'iPad';
    if (/iPhone|iPod/.test(userAgent)) return 'iPhone';
    if (/Android/.test(userAgent)) return /Mobile/.test(userAgent) ? 'Android phone' : 'Android tablet';
    if (/Win/.test(platform + userAgent)) return 'Windows PC';
    if (/Mac/.test(platform + userAgent)) return 'Mac';
    if (/CrOS/.test(userAgent)) return 'Chromebook';
    if (/Linux/.test(platform + userAgent)) return 'Linux computer';
    return /Mobile/.test(userAgent) ? 'Phone' : 'Computer';
  }
  return { MAX_MEMORY, MAX_FILE, WINDOW, CHUNK, checksum, digest, validId, validOffer, terminal, deviceLabel };
});
