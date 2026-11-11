import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig, parseArgs } from '../src/cli';

test('exact device selection and local settings are validated before opening a MIDI port', (t) => {
  assert.equal(loadConfig().deviceName, 'Launchpad MK2');
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'midi-api-test-'));
  t.after(() => { fs.unlinkSync(path.join(directory, 'config.json')); fs.rmdirSync(directory); });
  const config = path.join(directory, 'config.json');
  fs.writeFileSync(config, JSON.stringify({ deviceName: '2 - Launchpad MK2', port: 19101 }));
  assert.equal(loadConfig(config).deviceName, '2 - Launchpad MK2');
  for (const invalid of [{ port: 0 }, { port: '19100' }, { deviceName: '' },
    { heartbeatTimeoutMs: 0 }, { deviceInterface: 42 }]) {
    fs.writeFileSync(config, JSON.stringify(invalid));
    assert.throws(() => loadConfig(config));
  }
});

test('OBS control is never enabled by default; enabling requires the explicit startup flag', () => {
  assert.deepEqual(parseArgs([]), { configFile: undefined, enableObs: false });
  assert.equal(parseArgs(['--config', 'config.json']).enableObs, false);
  assert.deepEqual(parseArgs(['--config', 'config.json', '--enable-obs-microphone']), { configFile: 'config.json', enableObs: true });
  assert.throws(() => parseArgs(['--config']));
  assert.throws(() => parseArgs(['--enable-obs-microphone', '--enable-obs-microphone']));
  assert.equal(loadConfig().obs, null);
  assert.equal(loadConfig().microphone, null);
});
