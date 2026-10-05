// Optional Chromium ZIP64 check using a sparse source; no 4 GiB ZIP is written.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { once } = require('node:events');
const { chromium } = require('playwright');
const { createDriftServer } = require('../server');
(async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'driftshare-zip64-'));
  const app = createDriftServer({ accessCode: '5739' }); let browser;
  try {
    const source = path.join(directory, 'large.bin'), size = 2 ** 32 + 17;
    const handle = await fs.open(source, 'wx'); await handle.truncate(size); await handle.close();
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, args: ['--enable-precise-memory-info'] });
    const page = await browser.newPage(); await page.goto(`http://127.0.0.1:${app.server.address().port}/#code=5739`);
    await page.evaluate(() => { const input = document.createElement('input'); input.type = 'file'; input.id = 'zipFixture'; document.body.append(input); });
    await page.locator('#zipFixture').setInputFiles(source);
    const result = await page.evaluate(async () => {
      const file = document.querySelector('#zipFixture').files[0];
      const start = performance.now(), baseline = performance.memory.usedJSHeapSize; let peak = baseline;
      const zip = await DriftArchive.create([file], { onProgress: () => { peak = Math.max(peak, performance.memory.usedJSHeapSize); } });
      return { sourceSize: file.size, size: zip.size, header: [...new Uint8Array(await zip.slice(0, 60).arrayBuffer())],
        trailer: [...new Uint8Array(await zip.slice(zip.size - 98).arrayBuffer())], seconds: (performance.now() - start) / 1000, heapGrowth: peak - baseline };
    });
    assert.equal(result.sourceSize, size); assert.ok(result.size > size);
    const header = Buffer.from(result.header), trailer = Buffer.from(result.trailer);
    assert.equal(header.readUInt16LE(4), 45); assert.equal(header.readUInt32LE(18), 0xffffffff);
    assert.equal(header.readBigUInt64LE(30 + header.readUInt16LE(26) + 4), BigInt(size));
    assert.equal(trailer.readUInt32LE(0), 0x06064b50); assert.equal(trailer.readUInt32LE(56), 0x07064b50);
    assert.ok(trailer.readBigUInt64LE(48) > BigInt(2 ** 32));
    console.log(`Measured sampled JS heap growth: ${Math.round(result.heapGrowth / 1048576)} MiB`);
    assert.ok(result.heapGrowth < 256 * 1024 * 1024, 'ZIP preparation unexpectedly retained large JS payload buffers');
    console.log(`PASS: Chromium ZIP64 ${size}-byte source, ${result.seconds.toFixed(1)} s preparation, sampled JS heap growth ${Math.round(result.heapGrowth / 1048576)} MiB (not total browser RSS)`);
  } finally {
    await browser?.close(); for (const ws of app.wss.clients) ws.terminate(); await new Promise(resolve => app.server.close(resolve));
    await fs.rm(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
