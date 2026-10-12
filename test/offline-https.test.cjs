const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const https = require('node:https');
const { once } = require('node:events');
const { execFileSync } = require('node:child_process');
const { prepare } = require('../scripts/offline-https.cjs');
let openssl = true;
try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); } catch { openssl = false; }
test('offline HTTPS generates reusable CA and a certificate trusted by an explicit client', { skip: !openssl }, async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'driftshare-tls-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const first = prepare(directory), again = prepare(directory); assert.equal(first.fingerprint, again.fingerprint);
  assert.ok(fs.existsSync(first.publicCertificate));
  const server = https.createServer({ key: fs.readFileSync(first.key), cert: fs.readFileSync(first.cert) }, (_, response) => response.end('encrypted'));
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => new Promise(resolve => server.close(resolve)));
  const result = await new Promise((resolve, reject) => {
    https.get(`https://127.0.0.1:${server.address().port}`, { ca: fs.readFileSync(first.rootCert) }, response => {
      let body = ''; response.on('data', chunk => { body += chunk; }); response.on('end', () => resolve(body));
    }).on('error', reject);
  });
  assert.equal(result, 'encrypted');
});
