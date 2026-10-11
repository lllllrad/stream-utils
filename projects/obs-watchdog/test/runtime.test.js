'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { pollSources, watch } = require('../src/runtime');
const { makeSourceState } = require('../src/monitor');
const config = { sources: ['camera'], freezeThresholdChecks: 3, staleWarnMs: 5000, staleRecoverMs: 15000, recoveryCooldownMs: 30000, pollIntervalMs: 1, reconnectDelayMs: 1 };

test('stale capture board recovery uses visible peer evidence regardless of source order', async () => {
  for (const sources of [['capture', 'camera'], ['camera', 'capture']]) {
    const states = new Map(sources.map((name) => [name, makeSourceState()]));
    const calls = [];
    const logs = [];
    let time = 106000;
    const request = async (type, data) => {
      calls.push([type, data]);
      return type === 'GetSourceActive' ? { videoActive: true, videoShowing: true } : { inputSettings: { device: 'id' } };
    };
    const options = { now: () => time, log: (line) => logs.push(line), heartbeats: () => new Map([
      ['capture', { count: 5931260n, writtenAt: 100, filePath: 'capture' }],
      ['camera', { count: BigInt(time), writtenAt: time / 1000, filePath: 'camera' }],
    ]) };
    await pollSources({ ...config, sources }, request, states, options);
    time = 121000;
    await pollSources({ ...config, sources }, request, states, options);
    time = 121500;
    await pollSources({ ...config, sources }, request, states, options);
    assert.deepEqual(calls.filter(([type]) => type === 'SetInputSettings').map(([, data]) => data.inputName), ['capture']);
    const evidence = JSON.parse(logs.find((line) => line.includes('recovery evidence')).split('recovery evidence ')[1]);
    assert.deepEqual(evidence, { reason: 'stale', heartbeat: { count: '5931260', writtenAt: 100, ageMs: 21000 },
      videoActive: true, videoShowing: true, healthyPeers: ['camera'] });
  }
});

test('stale sources are not recovered without a visible fresh peer or with failed status requests', async () => {
  for (const scenario of ['single', 'all-stale', 'hidden-peer', 'missing-peer', 'future-peer', 'failed-peer', 'hidden-target', 'failed-target']) {
    const sources = scenario === 'single' ? ['capture'] : ['capture', 'camera'];
    const states = new Map(sources.map((name) => [name, makeSourceState()]));
    let time = 106000;
    let mutations = 0;
    const request = async (type, data) => {
      if (type !== 'GetSourceActive') { mutations++; return { inputSettings: {} }; }
      if ((scenario === 'failed-peer' && data.sourceName === 'camera')
        || (scenario === 'failed-target' && data.sourceName === 'capture')) throw new Error('lookup failed');
      return { videoShowing: !((scenario === 'hidden-peer' && data.sourceName === 'camera')
        || (scenario === 'hidden-target' && data.sourceName === 'capture')) };
    };
    const options = { now: () => time, log: () => {}, heartbeats: () => new Map([
      ['capture', { count: 1n, writtenAt: 100, filePath: 'capture' }],
      ['camera', scenario === 'missing-peer' ? null : { count: BigInt(time),
        writtenAt: scenario === 'all-stale' ? 100 : scenario === 'future-peer' ? 999 : time / 1000, filePath: 'camera' }],
    ]) };
    await pollSources({ ...config, sources }, request, states, options);
    time = 121000;
    await pollSources({ ...config, sources }, request, states, options);
    assert.equal(mutations, 0, scenario);
  }
});

test('dry-run logs native and pixel recovery decisions without querying or changing input settings', async () => {
  for (const mode of ['native', 'pixels']) {
    const states = new Map([['camera', makeSourceState()]]);
    const calls = [];
    const logs = [];
    const request = async (type) => {
      calls.push(type);
      if (type === 'GetSourceActive') return { videoShowing: true };
      if (type === 'GetSourceScreenshot') return { imageData: 'data:image/png;base64,aW1hZ2U=' };
      throw new Error('dry-run must not read or change input settings');
    };
    for (let i = 0; i < 5; i++) await pollSources({ ...config, dryRun: true }, request, states, {
      mode, now: () => 100000, log: (line) => logs.push(line),
      heartbeats: () => new Map([['camera', { count: 1n, writtenAt: 100, filePath: 'probe' }]]),
    });
    assert.equal(calls.includes('GetInputSettings'), false);
    assert.equal(calls.includes('SetInputSettings'), false);
    assert.equal(logs.filter((line) => line.includes('dry-run: would')).length, 1);
    assert.equal(states.get('camera').cooldownUntil, 130000);
  }
});

test('dry-run suppresses sustained stale recovery and applies cooldown', async () => {
  const sources = ['capture', 'camera'];
  const states = new Map(sources.map((name) => [name, makeSourceState()]));
  let time = 106000;
  const logs = [];
  const request = async (type) => {
    assert.equal(type, 'GetSourceActive');
    return { videoShowing: true };
  };
  const options = { now: () => time, log: (line) => logs.push(line), heartbeats: () => new Map([
    ['capture', { count: 1n, writtenAt: 100, filePath: 'capture' }],
    ['camera', { count: BigInt(time), writtenAt: time / 1000, filePath: 'camera' }],
  ]) };
  for (time of [106000, 121000, 121500]) await pollSources({ ...config, sources, dryRun: true }, request, states, options);
  assert.equal(logs.filter((line) => line.includes('dry-run: would')).length, 1);
  assert.equal(states.get('capture').cooldownUntil, 151000);
});

test('a failed stale recovery has a full cooldown and a new observation period', async () => {
  const sources = ['capture', 'camera'];
  const states = new Map(sources.map((name) => [name, makeSourceState()]));
  let time = 106000;
  let attempts = 0;
  const request = async (type) => {
    if (type === 'GetSourceActive') return { videoShowing: true };
    attempts++;
    throw new Error('device unavailable');
  };
  const options = { now: () => time, log: () => {}, heartbeats: () => new Map([
    ['capture', { count: 1n, writtenAt: 100, filePath: 'capture' }],
    ['camera', { count: BigInt(time), writtenAt: time / 1000, filePath: 'camera' }],
  ]) };
  for (time of [106000, 121000, 130000, 150000, 151000, 165000]) {
    await pollSources({ ...config, sources }, request, states, options);
  }
  assert.equal(attempts, 1);
  time = 166000;
  await pollSources({ ...config, sources }, request, states, options);
  assert.equal(attempts, 2);
});

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
