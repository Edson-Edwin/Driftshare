// Physical-device measurements are supplied by the operator, never synthesized.
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
function compare(fixture, runs) {
  if (!Number.isSafeInteger(fixture.bytes) || fixture.bytes < 1 || !/^[a-f0-9]{64}$/.test(fixture.sha256) || !Array.isArray(runs)) throw Error('Invalid fixture or run data.');
  const groups = new Map(); let environment;
  for (const run of runs) {
    if (!['DriftShare', 'LocalSend', 'PairDrop'].includes(run.app) || run.bytes !== fixture.bytes || run.sha256 !== fixture.sha256 ||
        !Number.isFinite(run.seconds) || run.seconds <= 0 || typeof run.devicePair !== 'string' || !run.devicePair.trim() ||
        typeof run.network !== 'string' || !run.network.trim() || typeof run.route !== 'string' || !run.route.trim()) throw Error('Every run needs matching size/hash, a positive duration, devicePair, network and route.');
    const key = JSON.stringify([run.devicePair, run.network]);
    if (environment && key !== environment) throw Error('Compare the same devices and network only.');
    environment = key;
    const groupKey = `${run.app} (${run.route})`;
    const times = groups.get(groupKey) || []; times.push(run.seconds); groups.set(groupKey, times);
  }
  return [...groups].map(([application, times]) => {
    times.sort((a, b) => a - b); const middle = Math.floor(times.length / 2);
    const medianSeconds = times.length % 2 ? times[middle] : (times[middle - 1] + times[middle]) / 2;
    return { application, runs: times.length, sufficientRuns: times.length >= 5, medianSeconds, worstSeconds: times.at(-1), medianMiBps: fixture.bytes / 1048576 / medianSeconds };
  });
}
async function generate(directory, bytes) {
  if (!Number.isSafeInteger(bytes) || bytes < 1024 || bytes > 5_000_000_000) throw Error('Fixture size must be 1 KiB to 5 GB.');
  await fsp.mkdir(directory, { recursive: true });
  const filename = path.join(directory, `fixture-${bytes}.bin`), hash = crypto.createHash('sha256');
  await pipeline(Readable.from((function* () {
    for (let offset = 0; offset < bytes; offset += 1024 * 1024) { const chunk = crypto.randomBytes(Math.min(1024 * 1024, bytes - offset)); hash.update(chunk); yield chunk; }
  })()), fs.createWriteStream(filename, { flags: 'wx' }));
  const fixture = { file: filename, bytes, sha256: hash.digest('hex') };
  await fsp.writeFile(`${filename}.json`, JSON.stringify(fixture, null, 2), { flag: 'wx' });
  return fixture;
}
if (require.main === module) (async () => {
  const [command, first, second] = process.argv.slice(2);
  if (command === 'generate' && first) console.log(JSON.stringify(await generate(path.resolve(first), second === undefined ? 100 * 1024 * 1024 : Number(second)), null, 2));
  else if (command === 'compare' && first && second) {
    const result = compare(JSON.parse(await fsp.readFile(first, 'utf8')), JSON.parse(await fsp.readFile(second, 'utf8')));
    console.table(result);
    if (['DriftShare', 'LocalSend', 'PairDrop'].some(app => !result.some(r => r.application.startsWith(`${app} (`))) || result.some(r => !r.sufficientRuns)) console.log('Incomplete comparison: collect at least five verified runs per app/route.');
    console.log('Results describe the supplied measurements only; device/network details and timings must be recorded on the physical devices.');
  } else throw Error('Usage: node scripts/benchmark.cjs generate <directory> [bytes] | compare <fixture.json> <runs.json>');
})().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { compare, generate };
