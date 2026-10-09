'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pollSources, watch } = require('../src/runtime');
const { makeSourceState } = require('../src/monitor');
const config = { sources: ['camera'], freezeThresholdChecks: 3, staleWarnMs: 5000, recoveryCooldownMs: 30000, pollIntervalMs: 1, reconnectDelayMs: 1 };

test('native polling avoids hidden sources and recovers a stopped visible source once', async () => {
  const states = new Map([['camera', makeSourceState()]]);
  const calls = [];
  let showing = false;
  const request = async (type) => { calls.push(type); return type === 'GetSourceActive' ? { videoShowing: showing } : { inputSettings: { device: 'id' } }; };
  const options = { now: () => 100000, log: () => {}, heartbeats: () => new Map([['camera', { count: 1n, writtenAt: 100, filePath: 'probe' }]]) };
  for (let i = 0; i < 5; i++) await pollSources(config, request, states, options);
  assert.equal(calls.filter((type) => type === 'SetInputSettings').length, 0);
  showing = true;
  for (let i = 0; i < 5; i++) await pollSources(config, request, states, options);
  assert.equal(calls.filter((type) => type === 'SetInputSettings').length, 1);
});

test('failed recovery still enters cooldown instead of repeatedly resetting a device', async () => {
  const state = makeSourceState();
  const states = new Map([['camera', state]]);
  let recoveries = 0;
  const request = async (type) => {
    if (type === 'GetSourceActive') return { videoShowing: true };
    recoveries++;
    throw new Error('device unavailable');
  };
  const options = { now: () => 100000, log: () => {}, heartbeats: () => new Map([['camera', { count: 1n, writtenAt: 100, filePath: 'probe' }]]) };
  for (let i = 0; i < 10; i++) await pollSources(config, request, states, options);
  assert.equal(recoveries, 1);
  assert.equal(state.cooldownUntil, 130000);
});

test('lookup error breaks consecutive freeze samples', async () => {
  const state = makeSourceState();
  state.lastValue = 1n;
  state.matches = 2;
  await pollSources(config, async () => { throw new Error('missing source'); }, new Map([['camera', state]]), {
    heartbeats: () => new Map(), log: () => {},
  });
  assert.equal(state.matches, 0);
});

test('watch retries a failed connection and releases clients on abort', async () => {
  const controller = new AbortController();
  let attempts = 0;
  let closed = 0;
  await watch(config, { signal: controller.signal, log: () => {}, connector: async () => {
    attempts++;
    if (attempts === 1) throw new Error('OBS offline');
    controller.abort();
    return { ws: { readyState: 1 }, request: async () => {}, close: () => closed++ };
  } });
  assert.equal(attempts, 2);
  assert.equal(closed, 1);
});

test('an empty watch list fails before connecting to OBS', async () => {
  await assert.rejects(watch({ ...config, sources: [] }, { log: () => {}, connector: () => { throw new Error('must not connect'); } }), /at least one source/);
});

test('legacy pixels mode compares screenshots and recovers a repeated image', async () => {
  const states = new Map([['camera', makeSourceState()]]);
  let recoveries = 0;
  let screenshots = 0;
  let showing = false;
  const request = async (type) => {
    if (type === 'GetSourceActive') return { videoShowing: showing };
    if (type === 'GetSourceScreenshot') { screenshots++; return { imageData: 'data:image/png;base64,aW1hZ2U=' }; }
    if (type === 'SetInputSettings') recoveries++;
    return { inputSettings: { device: 'id' } };
  };
  const options = { mode: 'pixels', log: () => {}, now: () => 100000 };
  await pollSources(config, request, states, options);
  assert.equal(screenshots, 0);
  showing = true;
  for (let i = 0; i < 5; i++) await pollSources(config, request, states, options);
  assert.equal(screenshots, 3);
  assert.equal(recoveries, 1);
});

test('watch reconnects after an established socket closes', async () => {
  const controller = new AbortController();
  let connections = 0;
  let closed = 0;
  await watch(config, { signal: controller.signal, log: () => {}, connector: async () => {
    connections++;
    if (connections === 2) controller.abort();
    return { ws: { readyState: 3 }, request: async () => {}, close: () => closed++ };
  } });
  assert.equal(connections, 2);
  assert.equal(closed, 2);
});
