/* Cross-engine transfers use real downloads. WebKit on Linux is not an iOS test. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { once } = require('node:events');
const playwright = require('playwright');
const { createDriftServer } = require('../server');
(async () => {
  const app = createDriftServer({ accessCode: '5739' });
  const browsers = [];
  try {
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    const url = `http://127.0.0.1:${app.server.address().port}/#code=5739`;
    const reference = await playwright.chromium.launch({ executablePath: process.env.CHROME_PATH || undefined }); browsers.push(reference);
    const payload = crypto.randomBytes(2 * 1024 * 1024 + 17);
    const digest = crypto.createHash('sha256').update(payload).digest('hex');
    const errors = [];
    async function device(browser, name, noRtc = false) {
      const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 390, height: 844 } });
      await context.addInitScript(({ name, noRtc }) => {
        localStorage.setItem('driftshare-name', name);
        if (noRtc) window.RTCPeerConnection = undefined;
        window.__wakeRequests = 0; window.__wakeReleases = 0;
        Object.defineProperty(navigator, 'wakeLock', { configurable: true, value: { request: async () => {
          window.__wakeRequests++;
          if (window.__denyWake) throw new DOMException('Denied', 'NotAllowedError');
          const lock = new EventTarget();
          lock.release = async () => { window.__wakeReleases++; lock.dispatchEvent(new Event('release')); };
          return lock;
        } } });
      }, { name, noRtc });
      const page = await context.newPage(); page.setDefaultTimeout(20000);
      page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
      await page.goto(url); await page.waitForSelector('.connection--connected');
      return page;
    }
    async function transfer(sender, receiver, receiverName, name, forceRelay = false, requiredRelay = false, bytes = payload) {
      const peer = sender.getByRole('button', { name: new RegExp(receiverName) });
      if (await peer.getAttribute('aria-pressed') !== 'true') await peer.click();
      await sender.locator('#fileInput').setInputFiles({ name, mimeType: 'application/octet-stream', buffer: bytes });
      await receiver.waitForSelector('#offerModal:not(.hidden)');
      const compact = name.endsWith('-host.bin');
      if (compact) {
        await receiver.setViewportSize({ width: 390, height: 360 });
        const bounds = await receiver.locator('#offerModal .modal-card').boundingBox();
        assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= 360, 'Consent dialog must fit a short viewport');
      }
      if (requiredRelay) {
        assert.equal(await receiver.locator('#useRelay').isChecked(), true);
        assert.equal(await receiver.locator('#useRelay').isDisabled(), true);
      }
      if (!await receiver.locator('#saveDirectly').isDisabled()) await receiver.locator('#saveDirectly').uncheck();
      const naturalRelay = await receiver.locator('#useRelay').isChecked();
      if (forceRelay && !naturalRelay) await receiver.locator('#useRelay').check();
      const relay = forceRelay || naturalRelay;
      const event = receiver.waitForEvent('download');
      await receiver.locator('#offerAccept').click();
      const card = page => page.locator('.transfer-card').filter({ has: page.locator('.transfer-name', { hasText: name }) });
      if (!relay) {
        await card(receiver).locator('.bar-fill.done').waitFor();
        await card(receiver).getByRole('button', { name: 'save file', exact: true }).click();
      }
      const download = await event;
      assert.equal(crypto.createHash('sha256').update(await fs.readFile(await download.path())).digest('hex'), bytes === payload ? digest : crypto.createHash('sha256').update(bytes).digest('hex'));
      await card(sender).locator('.bar-fill.done').waitFor();
      await sender.waitForFunction(() => window.__wakeRequests === window.__wakeReleases || window.__denyWake);
      assert.ok(await sender.evaluate(() => window.__wakeRequests > 0));
      assert.equal(await receiver.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
      if (compact) await receiver.setViewportSize({ width: 390, height: 844 });
      console.log(`PASS: ${name}, exact bytes, ${relay ? 'LAN download' : 'WebRTC'}, mobile-width layout`);
    }
    for (const engine of (process.env.DRIFTSHARE_BROWSERS || 'chromium,firefox,webkit').split(',')) {
      assert.ok(['chromium', 'firefox', 'webkit'].includes(engine), `Unknown engine: ${engine}`);
      const browser = engine === 'chromium' ? reference : await playwright[engine].launch();
      if (browser !== reference) browsers.push(browser);
      const sender = await device(reference, 'Reference');
      const receiver = await device(browser, 'Target');
      const zipped = await receiver.evaluate(async () => {
        const zip = await DriftArchive.create([new File(['nested content'], 'nested.txt'), new File([], 'empty.txt')]);
        const bytes = new Uint8Array(await zip.arrayBuffer());
        return { signature: new DataView(bytes.buffer).getUint32(0, true), text: new TextDecoder().decode(bytes) };
      });
      assert.equal(zipped.signature, 0x04034b50); assert.ok(zipped.text.includes('nested content'));
      console.log(`PASS: ${engine} streamed ZIP preparation`);
      await transfer(sender, receiver, 'Target', `${engine}-default.bin`);
      await transfer(sender, receiver, 'Target', `${engine}-host.bin`, true);
      await transfer(sender, receiver, 'Target', `${engine}-empty.bin`, true, false, Buffer.alloc(0));
      await transfer(receiver, sender, 'Reference', `${engine}-reverse.bin`, true);
      await sender.context().close(); await receiver.context().close();
      // No-WebRTC fallback must work with either endpoint missing the API.
      const limited = await device(browser, 'Limited', true);
      const normal = await device(reference, 'Normal');
      await normal.evaluate(() => { window.__denyWake = true; });
      await transfer(normal, limited, 'Limited', `${engine}-no-rtc-receiver.bin`, false, true);
      assert.equal(await normal.evaluate(() => window.__wakeRequests), 1, 'Denied wake lock must not be repeatedly requested during progress');
      await transfer(limited, normal, 'Normal', `${engine}-no-rtc-sender.bin`, false, true);
      await limited.context().close(); await normal.context().close();
    }
    assert.deepEqual(errors, []);
    console.log('PASS: capability fallback, wake-lock acquisition/release and denial, no browser exceptions');
  } finally {
    for (const browser of browsers) await browser.close();
    for (const socket of app.wss.clients) socket.terminate();
    await new Promise(resolve => app.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
