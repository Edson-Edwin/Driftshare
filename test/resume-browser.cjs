const assert = require('node:assert/strict');
const { once } = require('node:events');
const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const { createDriftServer } = require('../server');
(async () => {
  const app = createDriftServer({ accessCode: '5739' }); let browser;
  try {
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    const url = `http://127.0.0.1:${app.server.address().port}/#code=5739`;
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined });
    async function device(name) {
      const context = await browser.newContext({ acceptDownloads: true });
      await context.addInitScript(name => {
        localStorage.setItem('driftshare-name', name);
        const fetch = window.fetch; window.__uploads = [];
        window.fetch = (url, options) => { if (options?.method === 'PUT') window.__uploads.push(options.body.size); return fetch(url, options); };
      }, name);
      const page = await context.newPage(); page.setDefaultTimeout(20000);
      await page.goto(url); await page.waitForSelector('.connection--connected'); return page;
    }
    const sender = await device('Sender'), receiver = await device('Receiver');
    const network = await sender.context().newCDPSession(sender); await network.send('Network.enable');
    await network.send('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: 1024 * 1024 });
    const bytes = crypto.randomBytes(8 * 1024 * 1024 + 37);
    await sender.getByRole('button', { name: /Receiver/ }).click();
    await sender.locator('#fileInput').setInputFiles({ name: 'resume-test.bin', mimeType: 'application/octet-stream', buffer: bytes });
    await receiver.waitForSelector('#offerModal:not(.hidden)'); await receiver.locator('#useRelay').check();
    const downloadEvent = receiver.waitForEvent('download'); await receiver.locator('#offerAccept').click();
    const download = await downloadEvent;
    const manager = await receiver.context().newPage(); manager.setDefaultTimeout(20000); await manager.goto('chrome://downloads/');
    await sender.waitForFunction(() => document.querySelector('.transfer-stat')?.textContent.startsWith('1.') || document.querySelector('.transfer-stat')?.textContent.startsWith('2.'));
    // Break the live download socket after bytes reached the receiver, as Wi-Fi loss would.
    const active = [...app.transfers.values()].find(t => t.relay?.response);
    assert.ok(active); active.relay.response.destroy();
    await sender.locator('.transfer-footer').filter({ hasText: 'paused' }).waitFor();
    // Chromium may resume automatically. If it exposes Resume, use the native control.
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && (await sender.evaluate(() => window.__uploads.length)) < 2) {
      await manager.getByRole('button', { name: 'More actions', exact: true }).click();
      const resume = manager.getByText('Resume', { exact: true });
      if (await resume.isVisible()) { await resume.click(); break; }
      await manager.keyboard.press('Escape');
      await new Promise(resolve => setTimeout(resolve, 500));
    }
    const received = await fs.readFile(await download.path()); assert.deepEqual(received, bytes);
    await sender.locator('.bar-fill.done').waitFor();
    const uploads = await sender.evaluate(() => window.__uploads);
    assert.ok(uploads.length >= 2); assert.equal(uploads[0], bytes.length); assert.ok(uploads.at(-1) < bytes.length);
    console.log(`PASS: native Chromium Downloads interruption/resume, exact bytes, resumed upload ${uploads.at(-1)} of ${bytes.length} bytes`);
  } finally {
    await browser?.close(); for (const ws of app.wss.clients) ws.terminate(); await new Promise(resolve => app.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
