/* Real WebRTC transfers between isolated Chromium contexts. The disk test replaces
   only the interactive save picker with an OPFS file handle; writes remain native. */
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { once } = require('node:events');
const { chromium } = require('playwright');
const { createDriftServer } = require('../server');
(async () => {
  const app = createDriftServer({ accessCode: '5739' });
  const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'driftshare-browser-'));
  let browser;
  try {
    app.server.listen(0, '127.0.0.1'); await once(app.server, 'listening');
    const url = `http://127.0.0.1:${app.server.address().port}/#code=5739`;
    browser = await chromium.launch({ executablePath: process.env.CHROME_PATH || undefined, headless: true });
    const errors = [];
    async function device(name, manual = false) {
      const context = await browser.newContext({ acceptDownloads: true });
      await context.addInitScript(name => {
        localStorage.setItem('driftshare-name', name);
        const Original = window.RTCPeerConnection;
        window.__pcs = [];
        window.RTCPeerConnection = class extends Original { constructor(...args) { super(...args); window.__pcs.push(this); } };
        const send = RTCDataChannel.prototype.send;
        RTCDataChannel.prototype.send = function (data) {
          if (window.__corruptEnd && typeof data === 'string' && JSON.parse(data).type === 'end') {
            window.__corruptEnd = false; const message = JSON.parse(data); message.checksum = 'ffffffff'; data = JSON.stringify(message);
          }
          if (typeof data !== 'string') {
            window.__binaryBytes = (window.__binaryBytes || 0) + data.byteLength;
            if (window.__overflow) { window.__overflow = false; return send.call(this, new Uint8Array(data.byteLength + 1)); }
          }
          return send.call(this, data);
        };
        window.showSaveFilePicker = async ({ suggestedName }) => {
          if (window.__holdDisk) return { createWritable: async () => ({ write: () => new Promise(resolve => { window.__releaseDisk = resolve; }), abort: async () => window.__releaseDisk?.() }) };
          if (window.__failDisk) return { createWritable: async () => ({ write: async () => { throw new Error('Disk full (test)'); }, abort: async () => {} }) };
          const directory = await navigator.storage.getDirectory();
          return directory.getFileHandle(suggestedName, { create: true });
        };
      }, name);
      const page = await context.newPage(); page.on('pageerror', error => errors.push(`${name}: ${error.message}`));
      await page.goto(manual ? url.split('#')[0] : url);
      if (manual) {
        await page.locator('#accessCode').fill('5739');
        assert.equal(await page.locator('#accessCode').getAttribute('maxlength'), '4');
        await page.locator('#authForm').getByRole('button', { name: 'Join', exact: true }).click();
      }
      await page.waitForSelector('.connection--connected');
      return page;
    }
    const a = await device('Sender', true), b = await device('Receiver');
    await a.locator('#joinBtn').click();
    assert.equal(await a.locator('#joinCode').textContent(), '5739');
    await a.locator('#joinClose').click();
    console.log('PASS: manual 4-digit joining, private links, and displayed code');
    await a.getByRole('button', { name: /Receiver/ }).click();
    const payload = crypto.randomBytes(17 * 1024 * 1024 + 37);
    const originalHash = crypto.createHash('sha256').update(payload).digest('hex');
    async function choose(page, name, buffer) { await page.locator('#fileInput').setInputFiles({ name, mimeType: 'application/octet-stream', buffer }); }
    async function accept(page, direct = false) { await page.waitForSelector('#offerModal:not(.hidden)'); await page.locator('#saveDirectly').setChecked(direct); await page.locator('#offerAccept').click(); }
    const card = (page, name) => page.locator('.transfer-card').filter({ has: page.locator('.transfer-name', { hasText: name }) });
    async function complete(page, name) { await card(page, name).locator('.transfer-footer').filter({ hasText: 'complete' }).waitFor({ timeout: 45000 }); }
    await a.locator('#fileInput').setInputFiles([{ name: 'empty.bin', mimeType: 'application/octet-stream', buffer: Buffer.alloc(0) }, { name: 'random.bin', mimeType: 'application/octet-stream', buffer: payload }]);
    await accept(b); await complete(a, 'empty.bin');
    await accept(b); await complete(a, 'random.bin'); await complete(b, 'random.bin');
    const downloadEvent = b.waitForEvent('download'); await card(b, 'random.bin').getByRole('button', { name: 'save file', exact: true }).click();
    const download = await downloadEvent; const downloaded = await fs.readFile(await download.path());
    assert.equal(crypto.createHash('sha256').update(downloaded).digest('hex'), originalHash);
    assert.equal(await a.evaluate(() => window.__pcs.length), 1);
    assert.equal(await b.evaluate(() => window.__pcs.length), 1);
    console.log('PASS: empty + 17 MiB batch, byte-perfect download, one reused peer connection');

    await choose(a, 'cancel-before-accept.bin', Buffer.from('cancel'));
    await b.waitForSelector('#offerModal:not(.hidden)'); await card(a, 'cancel-before-accept.bin').getByRole('button', { name: 'cancel', exact: true }).click();
    await b.waitForSelector('#offerModal.hidden', { state: 'attached' });
    console.log('PASS: cancellation removes pending receiver prompt');

    await a.evaluate(() => { window.__corruptEnd = true; });
    await choose(a, 'corrupt.bin', Buffer.from('integrity')); await accept(b);
    await card(b, 'corrupt.bin').getByText('File integrity check failed. Please retry.', { exact: true }).waitFor();
    await card(a, 'corrupt.bin').getByText('File integrity check failed. Please retry.', { exact: true }).waitFor();
    assert.equal(await card(a, 'corrupt.bin').locator('.bar-fill.done').count(), 0);
    console.log('PASS: corrupted checksum fails both sides without success acknowledgment');

    await choose(a, 'disk.bin', payload); await accept(b, true); await complete(a, 'disk.bin'); await complete(b, 'disk.bin');
    const diskHash = await b.evaluate(async () => {
      const root = await navigator.storage.getDirectory(); const handle = await root.getFileHandle('disk.bin');
      const result = await crypto.subtle.digest('SHA-256', await (await handle.getFile()).arrayBuffer());
      return [...new Uint8Array(result)].map(byte => byte.toString(16).padStart(2, '0')).join('');
    });
    assert.equal(diskHash, originalHash);
    console.log('PASS: direct disk streaming commits the exact bytes');

    await b.evaluate(() => { window.__failDisk = true; });
    await choose(a, 'disk-full.bin', Buffer.from('disk failure')); await accept(b, true);
    await card(a, 'disk-full.bin').getByText('Could not receive file: Disk full (test)', { exact: true }).waitFor();
    await b.evaluate(() => { window.__failDisk = false; });
    console.log('PASS: disk write failure reaches sender and releases transfer');

    await a.evaluate(() => { window.__overflow = true; });
    await choose(a, 'oversend.bin', Buffer.from('too much')); await accept(b, false);
    await card(b, 'oversend.bin').getByText('The sender exceeded the agreed file size or receive window.', { exact: true }).waitFor();
    await card(a, 'oversend.bin').locator('.transfer-footer').filter({ hasText: 'failed' }).waitFor();
    console.log('PASS: excess bytes are rejected before being retained');

    await a.evaluate(() => { window.__binaryBytes = 0; });
    await b.evaluate(() => { window.__holdDisk = true; });
    await choose(a, 'slow-disk.bin', payload); await accept(b, true);
    await a.waitForFunction(() => window.__binaryBytes >= 2 * 1024 * 1024);
    await new Promise(resolve => setTimeout(resolve, 300));
    assert.equal(await a.evaluate(() => window.__binaryBytes), 2 * 1024 * 1024);
    await card(a, 'slow-disk.bin').getByRole('button', { name: 'cancel', exact: true }).click();
    await card(b, 'slow-disk.bin').locator('.transfer-footer').filter({ hasText: 'cancelled' }).waitFor();
    await b.evaluate(() => { window.__holdDisk = false; });
    console.log('PASS: stalled disk bounds in-flight bytes to 2 MiB; active cancellation unblocks both sides');

    const huge = path.join(temporary, 'large-download.bin'); const handle = await fs.open(huge, 'w'); await handle.truncate(129 * 1024 * 1024); await handle.close();
    await a.locator('#fileInput').setInputFiles(huge);
    const largeDownloadEvent = b.waitForEvent('download'); await accept(b, false);
    const largeDownload = await largeDownloadEvent;
    const largePath = await largeDownload.path();
    assert.equal((await fs.stat(largePath)).size, 129 * 1024 * 1024);
    const streamedHash = crypto.createHash('sha256');
    for await (const chunk of require('node:fs').createReadStream(largePath)) streamedHash.update(chunk);
    const sourceHash = crypto.createHash('sha256');
    for await (const chunk of require('node:fs').createReadStream(huge)) sourceHash.update(chunk);
    assert.equal(streamedHash.digest('hex'), sourceHash.digest('hex'));
    await card(a, 'large-download.bin').locator('.bar-fill.done').waitFor();
    assert.equal(await b.evaluate(() => window.__pcs.length), 1);
    console.log('PASS: 129 MiB native download via LAN host, exact bytes, no extra WebRTC connection');

    const overLimit = path.join(temporary, 'over-5gb.bin'); const oversize = await fs.open(overLimit, 'w');
    await oversize.truncate(5_000_000_001); await oversize.close();
    await a.locator('#fileInput').setInputFiles(overLimit);
    await a.locator('.toast').filter({ hasText: 'exceeds the 5 GB limit' }).waitFor();
    assert.equal(await card(a, 'over-5gb.bin').count(), 0);
    console.log('PASS: files above 5 GB are rejected before offering');

    await b.getByRole('button', { name: /Sender/ }).click();
    await Promise.all([choose(a, 'forward.bin', Buffer.from('forward')), choose(b, 'reverse.bin', Buffer.from('reverse'))]);
    await Promise.all([accept(a, false), accept(b, false)]);
    await Promise.all([complete(a, 'forward.bin'), complete(b, 'reverse.bin')]);
    console.log('PASS: simultaneous bidirectional transfers');

    await choose(a, 'disconnect.bin', Buffer.from('disconnect'));
    await b.waitForSelector('#offerModal:not(.hidden)'); await b.reload();
    await card(a, 'disconnect.bin').locator('.transfer-footer').filter({ hasText: 'failed' }).waitFor();
    await b.waitForSelector('.connection--connected'); await a.getByRole('button', { name: /Receiver/ }).click();
    await card(a, 'disconnect.bin').getByRole('button', { name: 'retry', exact: true }).click(); await accept(b, false);
    await card(a, 'disconnect.bin').locator('.bar-fill.done').waitFor();
    console.log('PASS: disconnect cleanup and manual retry after reconnect');
    const c = await device('Recipient C');
    await a.getByRole('button', { name: /Recipient C/ }).click();
    await a.locator('#targetLabel').filter({ hasText: 'Sending to 2 devices' }).waitFor();
    // The same large file must stream independently to both native download managers.
    const multiDownloads = [b.waitForEvent('download'), c.waitForEvent('download')];
    await a.locator('#fileInput').setInputFiles(huge);
    await Promise.all([accept(b, false), accept(c, false)]);
    const expectedLargeHash = crypto.createHash('sha256');
    for await (const chunk of require('node:fs').createReadStream(huge)) expectedLargeHash.update(chunk);
    const largeDigest = expectedLargeHash.digest('hex');
    for (const event of multiDownloads) {
      const result = await event; const file = await result.path();
      assert.equal((await fs.stat(file)).size, 129 * 1024 * 1024);
      const hash = crypto.createHash('sha256');
      for await (const chunk of require('node:fs').createReadStream(file)) hash.update(chunk);
      assert.equal(hash.digest('hex'), largeDigest);
    }
    await a.waitForFunction(() => [...document.querySelectorAll('.transfer-card')].filter(el => el.querySelector('.transfer-name').textContent.includes('large-download.bin') && el.querySelector('.bar-fill.done')).length === 3);
    console.log('PASS: same 129 MiB file delivered to two recipients via independent LAN downloads');

    const d = await device('Recipient D'), e = await device('Recipient E'), f = await device('Recipient F');
    for (const name of ['Recipient D', 'Recipient E', 'Recipient F']) await a.getByRole('button', { name: new RegExp(name) }).click();
    await a.locator('#targetLabel').filter({ hasText: 'Sending to 5 devices' }).waitFor();
    // Toggling is independent and does not clear other selections.
    await a.getByRole('button', { name: /Recipient F/ }).click();
    assert.equal(await a.locator('.peer-card[aria-pressed="true"]').count(), 4);
    await a.getByRole('button', { name: /Recipient F/ }).click();
    const multiPayload = crypto.randomBytes(512 * 1024 + 13);
    const multiHash = crypto.createHash('sha256').update(multiPayload).digest('hex');
    await c.evaluate(() => { window.__holdDisk = true; });
    await a.locator('#fileInput').setInputFiles(['broadcast-first.bin', 'broadcast-second.bin'].map(name => ({ name, mimeType: 'application/octet-stream', buffer: multiPayload })));
    for (const recipient of [b, c, d, e]) await recipient.waitForSelector('#offerModal:not(.hidden)');
    assert.equal(await f.locator('#offerModal:not(.hidden)').count(), 0);
    assert.match(await a.locator('#queueStatus').textContent(), /4\/4 outgoing active · 6 queued/);
    await b.locator('#offerReject').click();
    await f.waitForSelector('#offerModal:not(.hidden)');
    await accept(c, true);
    await Promise.all([d, e, f].map(page => accept(page, false)));
    await Promise.all([d, e, f].map(page => complete(page, 'broadcast-first.bin')));
    assert.equal(await card(c, 'broadcast-first.bin').locator('.bar-fill.done').count(), 0);
    const firstToC = card(a, 'broadcast-first.bin').filter({ hasText: 'to Recipient C ·' });
    await firstToC.getByRole('button', { name: 'cancel', exact: true }).click();
    await c.evaluate(() => { window.__holdDisk = false; });
    await card(c, 'broadcast-first.bin').locator('.transfer-footer').filter({ hasText: 'cancelled' }).waitFor();
    for (const recipient of [b, c, d, e, f]) {
      await recipient.locator('#offerTitle').filter({ hasText: 'broadcast-second.bin' }).waitFor();
      await accept(recipient, true); await complete(recipient, 'broadcast-second.bin');
      const hash = await recipient.evaluate(async () => {
        const handle = await (await navigator.storage.getDirectory()).getFileHandle('broadcast-second.bin');
        return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', await (await handle.getFile()).arrayBuffer())), byte => byte.toString(16).padStart(2, '0')).join('');
      });
      assert.equal(hash, multiHash);
    }
    await a.locator('#queueStatus').filter({ hasText: '0/4 outgoing active · 0 queued' }).waitFor();
    // All five remain selected: retry must target only the declined recipient.
    await card(a, 'broadcast-first.bin').filter({ hasText: 'to Receiver · declined' }).getByRole('button', { name: 'retry', exact: true }).click();
    await accept(b, false); await complete(b, 'broadcast-first.bin');
    await a.locator('#queueStatus').filter({ hasText: '0/4 outgoing active · 0 queued' }).waitFor();
    assert.equal(await card(a, 'broadcast-first.bin').count(), 6);
    for (const recipient of [c, d, e, f]) assert.equal(await recipient.locator('#offerModal:not(.hidden)').count(), 0);
    assert.equal(await a.locator('.peer-card[aria-pressed="true"]').count(), 5);
    console.log('PASS: four-recipient cap, fifth queued, stalled recipient isolation, decline/cancel, ordered batches, exact bytes, targeted retry');
    await a.setViewportSize({ width: 390, height: 844 });
    assert.equal(await a.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await a.locator('.peer-card.selected .peer-badge').first().waitFor({ state: 'visible' });
    await a.screenshot({ path: path.join(temporary, 'multi-mobile.png'), fullPage: true });
    for (const recipient of [c, d, e, f]) await recipient.context().close();
    // Extra recipients have disconnected; the remaining receiver gets one offer per ZIP.
    const folder = path.join(temporary, 'folder'); await fs.mkdir(path.join(folder, 'nested'), { recursive: true });
    await fs.writeFile(path.join(folder, 'one.txt'), 'first'); await fs.writeFile(path.join(folder, 'nested', 'two.txt'), 'second');
    await a.locator('#folderInput').setInputFiles(folder);
    await b.locator('#offerTitle').filter({ hasText: 'folder.zip' }).waitFor();
    await accept(b, false); await complete(a, 'folder.zip');
    const zipEvent = b.waitForEvent('download'); await card(b, 'folder.zip').getByRole('button', { name: 'save file', exact: true }).click();
    const zipBytes = await fs.readFile(await (await zipEvent).path());
    assert.ok(zipBytes.includes(Buffer.from('folder/nested/two.txt'))); assert.ok(zipBytes.includes(Buffer.from('second')));
    await fs.writeFile(path.join(temporary, 'verified-folder.zip'), zipBytes);
    await a.locator('#bundleFiles').check();
    await a.locator('#fileInput').setInputFiles([{ name: 'a.txt', mimeType: 'text/plain', buffer: Buffer.from('A') }, { name: 'b.txt', mimeType: 'text/plain', buffer: Buffer.from('B') }]);
    await b.locator('#offerTitle').filter({ hasText: 'DriftShare-files.zip' }).waitFor();
    await accept(b, false); await complete(a, 'DriftShare-files.zip');
    await a.locator('#bundleFiles').uncheck();
    const exported = a.waitForEvent('download'); await a.locator('#exportResults').click();
    const report = JSON.parse(await fs.readFile(await (await exported).path(), 'utf8'));
    assert.ok(report.results.some(item => item.name === 'folder.zip' && item.status === 'done'));
    assert.ok(report.results.every(item => !('token' in item)));
    console.log('PASS: folder paths in ZIP, single acceptance for a file batch, exportable delivery results');
    await b.evaluate(() => localStorage.setItem('driftshare-name', 'This device'));
    // A separate fresh context exercises default labels rather than the fixture's custom names.
    const namingContext = await browser.newContext();
    const named = await namingContext.newPage(); await named.goto(url);
    await named.waitForSelector('.connection--connected');
    const generatedName = await named.locator('#meName').textContent();
    assert.match(generatedName, / · [0-9]{4}$/); assert.doesNotMatch(generatedName, /This device/);
    await named.reload(); await named.waitForSelector('.connection--connected');
    assert.equal(await named.locator('#meName').textContent(), generatedName);
    await named.evaluate(() => localStorage.setItem('driftshare-name', 'This device'));
    await named.reload(); await named.waitForSelector('.connection--connected');
    assert.doesNotMatch(await named.locator('#meName').textContent(), /This device/);
    await namingContext.close();
    console.log('PASS: automatic device names persist and migrate old generic labels');
    await b.screenshot({ path: path.join(temporary, 'desktop.png'), fullPage: true });
    await b.setViewportSize({ width: 390, height: 844 }); await b.screenshot({ path: path.join(temporary, 'mobile.png'), fullPage: true });
    assert.equal(await b.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    assert.deepEqual(errors, []);
    console.log(`PASS: no browser exceptions or mobile horizontal overflow. Screenshots: ${temporary}`);
  } catch (error) {
    if (browser) for (const context of browser.contexts()) for (const page of context.pages()) console.error('PAGE STATE:', await page.locator('body').innerText().catch(() => 'unavailable'));
    throw error;
  } finally {
    await browser?.close(); for (const socket of app.wss.clients) socket.terminate();
    await new Promise(resolve => app.server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
