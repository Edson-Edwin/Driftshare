// Generate an offline CA once, and renew a LAN server certificate as needed.
// Never modifies any OS trust store; the public CA must be trusted on each device.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { getLanAddresses, createDriftServer } = require('../server');
function prepare(directory = process.env.DRIFTSHARE_TLS_DIR || path.resolve('.driftshare-tls')) {
  try { execFileSync('openssl', ['version'], { stdio: 'ignore' }); }
  catch { throw new Error('OpenSSL is required on the host. Install OpenSSL, then run npm run start:secure again. Receiving devices only need a browser.'); }
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const rootKey = path.join(directory, 'root.key'), rootCert = path.join(directory, 'root.crt');
  const key = path.join(directory, 'server.key'), cert = path.join(directory, 'server.crt');
  const lock = path.join(directory, 'setup.lock');
  const descriptor = fs.openSync(lock, 'wx', 0o600); fs.closeSync(descriptor);
  const temporary = fs.mkdtempSync(path.join(directory, '.build-'));
  const openssl = args => execFileSync('openssl', args, { stdio: ['ignore', 'ignore', 'pipe'] });
  try {
    if (fs.existsSync(rootKey) !== fs.existsSync(rootCert)) throw new Error('The CA files are incomplete. Restore the matching root.key/root.crt pair; do not silently replace a trusted CA.');
    if (!fs.existsSync(rootCert)) {
      const pendingKey = path.join(temporary, 'root.key'), pendingCert = path.join(temporary, 'root.crt');
      openssl(['req', '-x509', '-newkey', 'rsa:3072', '-nodes', '-sha256', '-days', '3650', '-subj', `/CN=DriftShare Offline ${crypto.randomBytes(4).toString('hex')}`,
        '-addext', 'basicConstraints=critical,CA:TRUE,pathlen:0', '-addext', 'keyUsage=critical,keyCertSign,cRLSign', '-keyout', pendingKey, '-out', pendingCert]);
      fs.chmodSync(pendingKey, 0o600); fs.renameSync(pendingKey, rootKey); fs.renameSync(pendingCert, rootCert);
    }
    const root = new crypto.X509Certificate(fs.readFileSync(rootCert));
    if (!root.ca || !root.checkPrivateKey(crypto.createPrivateKey(fs.readFileSync(rootKey)))) throw new Error('Offline CA certificate and private key do not match.');
    if (Date.parse(root.validTo) < Date.now() + 31 * 86400000) throw new Error('The offline CA is expiring. Replace it deliberately and update trust on your devices.');
    const addresses = ['127.0.0.1', ...getLanAddresses()];
    let renew = true;
    if (fs.existsSync(cert) && fs.existsSync(key)) {
      const current = new crypto.X509Certificate(fs.readFileSync(cert));
      renew = !current.verify(root.publicKey) || !current.checkPrivateKey(crypto.createPrivateKey(fs.readFileSync(key))) || Date.parse(current.validTo) < Date.now() + 7 * 86400000 || !current.checkHost('localhost') || addresses.some(ip => !current.checkIP(ip));
    }
    if (renew) {
      const pendingKey = path.join(temporary, 'server.key'), pendingCert = path.join(temporary, 'server.crt');
      const csr = path.join(temporary, 'server.csr'), config = path.join(temporary, 'extensions.cnf');
      fs.writeFileSync(config, `basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\nsubjectAltName=DNS:localhost,${addresses.map(ip => `IP:${ip}`).join(',')}\n`, { mode: 0o600 });
      openssl(['req', '-new', '-newkey', 'rsa:2048', '-nodes', '-subj', '/CN=DriftShare LAN', '-keyout', pendingKey, '-out', csr]);
      openssl(['x509', '-req', '-in', csr, '-CA', rootCert, '-CAkey', rootKey, '-set_serial', `0x${crypto.randomBytes(16).toString('hex')}`,
        '-days', '30', '-sha256', '-extfile', config, '-out', pendingCert]);
      openssl(['verify', '-CAfile', rootCert, pendingCert]);
      fs.chmodSync(pendingKey, 0o600); fs.renameSync(pendingKey, key); fs.renameSync(pendingCert, cert);
    }
    const publicCertificate = path.join(directory, 'driftshare-root.cer'); fs.writeFileSync(publicCertificate, root.raw);
    return { key, cert, rootCert, publicCertificate, fingerprint: root.fingerprint256 };
  } finally { fs.rmSync(temporary, { recursive: true, force: true }); fs.unlinkSync(lock); }
}
if (require.main === module) {
  try {
    const result = prepare();
    console.log(`Public root certificate to trust once on each receiving device: ${result.publicCertificate}`);
    console.log(`Verify its SHA-256 fingerprint against this host: ${result.fingerprint}`);
    console.log('Keep root.key and server.key private. This command does not install trust on any device.');
    if (!process.argv.includes('--setup-only')) {
      process.env.TLS_CERT = result.cert; process.env.TLS_KEY = result.key;
      const app = createDriftServer();
      app.server.listen(process.env.PORT || 4443, process.env.HOST || '0.0.0.0', () => {
        console.log(`Join code: ${app.accessCode}`); for (const url of app.joinUrls()) console.log(url);
      });
      app.server.on('error', error => { console.error(error.message); process.exitCode = 1; });
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
module.exports = { prepare };
