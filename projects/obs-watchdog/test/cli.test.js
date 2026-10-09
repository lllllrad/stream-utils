'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const cli = path.resolve(__dirname, '../src/cli.js');

test('help works without OBS, password or a local configuration file', () => {
  const result = spawnSync(process.execPath, [cli, '--help'], { encoding: 'utf8', env: { ...process.env, OBS_WATCHDOG_CONFIG: 'does-not-exist.json' } });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /OBS watchdog/);
});

test('invalid or incomplete commands fail before connecting', () => {
  for (const args of [['typo'], ['recover'], ['filter', 'remove'], ['filter', 'add', 'camera', 'kind', 'extra'], ['watch', 'extra']]) {
    const result = spawnSync(process.execPath, [cli, ...args], { encoding: 'utf8' });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Invalid command/);
  }
});
