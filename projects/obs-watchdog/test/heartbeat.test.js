'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseHeartbeat, readHeartbeats } = require('../src/heartbeat');

test('Unicode source names and 64-bit frame counters are preserved', () => {
  assert.deepEqual(parseHeartbeat('카메라(3)\t18446744073709551615\t1791540000\r\n'),
    { name: '카메라(3)', count: 18446744073709551615n, writtenAt: 1791540000 });
});

test('partial, negative, malformed and missing fields are rejected', () => {
  for (const record of ['', 'camera\t1', 'camera\tNaN\t1', 'camera\t-1\t1', 'camera\t1\t0', 'camera\t1\t1\textra']) {
    assert.throws(() => parseHeartbeat(record), /Invalid heartbeat/);
  }
});

test('selects the newest record by source content, ignores temporary and broken records', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-heartbeat-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'obs-frame-heartbeat-native-old.txt'), '카메라\t1\t100\n');
  fs.writeFileSync(path.join(dir, 'obs-frame-heartbeat-native-new.txt'), '카메라\t2\t200\n');
  fs.writeFileSync(path.join(dir, 'obs-frame-heartbeat-native-bad.txt'), '카메라\t');
  fs.writeFileSync(path.join(dir, 'obs-frame-heartbeat-native-ignore.tmp'), '카메라\t3\t300\n');
  const records = readHeartbeats(dir);
  assert.equal(records.size, 1);
  assert.equal(records.get('카메라').count, 2n);
});

test('missing directory returns no heartbeat', () => {
  assert.equal(readHeartbeats(path.join(os.tmpdir(), 'missing-watchdog-heartbeats')).size, 0);
});

test('same-second duplicate records use modification time to select the current probe', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'watchdog-heartbeat-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const old = path.join(dir, 'obs-frame-heartbeat-native-old.txt');
  const current = path.join(dir, 'obs-frame-heartbeat-native-current.txt');
  fs.writeFileSync(old, 'camera\t100\t100\n');
  fs.writeFileSync(current, 'camera\t1\t100\n');
  fs.utimesSync(old, 100, 100);
  fs.utimesSync(current, 101, 101);
  assert.equal(readHeartbeats(dir).get('camera').count, 1n);
});
