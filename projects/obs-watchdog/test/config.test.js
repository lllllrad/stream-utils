'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadConfig } = require('../src/config');

function fixture(t, data) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-config-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'config.json');
  fs.writeFileSync(file, JSON.stringify(data));
  return file;
}

test('environment overrides local config and paths resolve relative to config', (t) => {
  const file = fixture(t, { host: 'localhost', port: 4455, sources: ['카메라', '카메라'], heartbeatDir: 'beats', logFile: 'logs/watch.log' });
  const config = loadConfig({ OBS_WS_HOST: '127.0.0.2', OBS_WS_PORT: '4456', OBS_WS_PASSWORD: 'test-only' }, file);
  assert.equal(config.host, '127.0.0.2');
  assert.equal(config.port, 4456);
  assert.equal(config.password, 'test-only');
  assert.deepEqual(config.sources, ['카메라']);
  assert.equal(config.heartbeatDir, path.join(path.dirname(file), 'beats'));
});

test('explicit missing config fails rather than silently ignoring a typo', () => {
  assert.throws(() => loadConfig({}, path.join(os.tmpdir(), 'missing-watchdog-config', 'config.json')), /not found/);
});

for (const [name, data] of Object.entries({
  port: { port: 65536 }, interval: { pollIntervalMs: 0 }, threshold: { freezeThresholdChecks: 1 },
  sources: { sources: 'camera' }, emptySource: { sources: [''] }, tab: { sources: ['a\tb'] },
  unknown: { passwrod: 'typo' }, host: { host: 'localhost/path' }, path: { logFile: '' },
  staleRecovery: { staleRecoverMs: 5000 }, staleRecoveryZero: { staleRecoverMs: 0 },
  staleRecoveryFraction: { staleRecoverMs: 15000.5 }, dryRun: { dryRun: 'true' },
})) {
  test(`rejects invalid ${name}`, (t) => assert.throws(() => loadConfig({}, fixture(t, data))));
}

test('environment port must be numeric', (t) => {
  assert.throws(() => loadConfig({ OBS_WS_PORT: 'bad' }, fixture(t, {})), /port/);
});

test('stale recovery and dry-run defaults and overrides are validated', (t) => {
  const defaults = loadConfig({}, fixture(t, {}));
  assert.equal(defaults.staleRecoverMs, 15000);
  assert.equal(defaults.dryRun, false);
  const custom = loadConfig({}, fixture(t, { staleRecoverMs: 20000, dryRun: true }));
  assert.equal(custom.staleRecoverMs, 20000);
  assert.equal(custom.dryRun, true);
});
