'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { makeSourceState, observe, recoverSource } = require('../src/monitor');

const config = { freezeThresholdChecks: 3, recoveryCooldownMs: 30000, staleWarnMs: 5000 };
function sample(count, now = 100000, showing = true, filePath = 'probe') {
  return { now, showing, heartbeat: { count: BigInt(count), writtenAt: Math.floor(now / 1000), filePath } };
}

test('recovers only after three unchanged observations and applies cooldown', () => {
  const state = makeSourceState();
  assert.equal(observe(state, sample(10), config), 'healthy');
  assert.equal(observe(state, sample(10, 100500), config), 'healthy');
  assert.equal(observe(state, sample(10, 101000), config), 'recover');
  assert.equal(observe(state, sample(10, 101500), config), 'cooldown');
  assert.equal(observe(state, sample(10, 131000), config), 'healthy');
});

test('new frames, counter restart and new files reset the comparison', () => {
  const state = makeSourceState();
  for (const value of [10, 11, 0, 1]) assert.equal(observe(state, sample(value), config), 'healthy');
  observe(state, sample(1), config);
  assert.equal(observe(state, sample(1, 100000, true, 'new-probe'), config), 'healthy');
  assert.equal(state.matches, 1);
});

test('hidden sources are excluded and must establish a new baseline when shown', () => {
  const state = makeSourceState();
  observe(state, sample(10), config);
  observe(state, sample(10), config);
  assert.equal(observe(state, sample(10, 100000, false), config), 'hidden');
  assert.equal(observe(state, sample(10), config), 'healthy');
  assert.equal(state.matches, 1);
});

test('missing and stale heartbeat warnings are emitted once and reset stale comparisons', () => {
  const state = makeSourceState();
  observe(state, sample(10), config);
  observe(state, sample(10), config);
  const missing = { now: 100000, showing: true, heartbeat: null };
  assert.equal(observe(state, missing, config), 'missing');
  assert.equal(observe(state, missing, config), 'waiting');
  const stale = { ...sample(10), now: 106000 };
  assert.equal(observe(state, stale, config), 'stale');
  assert.equal(observe(state, stale, config), 'waiting');
  assert.equal(observe(state, sample(10, 107000), config), 'healthy');
});

test('timestamps in the future cannot trigger a recovery', () => {
  assert.equal(observe(makeSourceState(), { ...sample(10), now: 90000 }, config), 'stale');
});

test('recovery reapplies the original settings with overlay enabled', async () => {
  const calls = [];
  const request = async (type, data) => { calls.push([type, data]); return { inputSettings: { device: 'camera', resolution: '1920x1080' } }; };
  await recoverSource(request, '카메라');
  assert.deepEqual(calls, [
    ['GetInputSettings', { inputName: '카메라' }],
    ['SetInputSettings', { inputName: '카메라', inputSettings: { device: 'camera', resolution: '1920x1080' }, overlay: true }],
  ]);
});

test('settings lookup failures prevent any mutation', async () => {
  let calls = 0;
  await assert.rejects(recoverSource(async () => { calls++; throw new Error('missing source'); }, 'camera'), /missing source/);
  assert.equal(calls, 1);
});
