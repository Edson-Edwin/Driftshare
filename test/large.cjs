// Keep the 5 GB regression command portable to Windows, macOS and Linux shells.
const { spawnSync } = require('node:child_process');
const path = require('node:path');
const result = spawnSync(process.execPath, ['--test', '--test-name-pattern=relay streams', path.join(__dirname, 'server.test.cjs')], {
  stdio: 'inherit', env: { ...process.env, DRIFTSHARE_TEST_BYTES: '5000000000' }
});
if (result.error) console.error(result.error);
process.exitCode = result.status ?? 1;
