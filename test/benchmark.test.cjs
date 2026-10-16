const { test } = require('node:test');
const assert = require('node:assert/strict');
const { compare } = require('../scripts/benchmark.cjs');
const fixture = { bytes: 1048576, sha256: 'a'.repeat(64) };
const run = { ...fixture, app: 'DriftShare', seconds: 2, devicePair: 'Windows / Android', network: 'same AP', route: 'LAN relay' };
test('benchmark comparison computes medians and refuses mismatched or unverified transfers', () => {
  const [result] = compare(fixture, [5, 1, 4, 2, 3].map(seconds => ({ ...run, seconds })));
  assert.equal(result.medianSeconds, 3); assert.equal(result.worstSeconds, 5); assert.equal(result.sufficientRuns, true);
  assert.throws(() => compare(fixture, [{ ...run, sha256: 'b'.repeat(64) }]), /matching/);
  assert.throws(() => compare(fixture, [run, { ...run, network: 'other AP' }]), /same devices/);
  assert.throws(() => compare(fixture, [{ ...run, seconds: 0 }]), /positive/);
});
