'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { manageFilter, FILTER_KIND } = require('../src/filters');

test('adding an existing native filter is idempotent', async () => {
  const calls = [];
  await manageFilter(async (type) => { calls.push(type); return { filters: [{ filterKind: FILTER_KIND, filterName: 'probe' }] }; }, 'add', 'camera');
  assert.deepEqual(calls, ['GetSourceFilterList']);
});

test('remove targets all native probes and leaves unrelated filters intact', async () => {
  const calls = [];
  const request = async (type, data) => {
    calls.push([type, data]);
    return { filters: [{ filterKind: FILTER_KIND, filterName: 'probe1' }, { filterKind: 'color_filter', filterName: 'color' }, { filterKind: FILTER_KIND, filterName: 'probe2' }] };
  };
  await manageFilter(request, 'remove', 'camera');
  assert.deepEqual(calls.slice(1), [
    ['RemoveSourceFilter', { sourceName: 'camera', filterName: 'probe1' }],
    ['RemoveSourceFilter', { sourceName: 'camera', filterName: 'probe2' }],
  ]);
});

test('reattach recreates the native kind rather than the obsolete Lua filter', async () => {
  const calls = [];
  await manageFilter(async (type, data) => { calls.push([type, data]); return { filters: [{ filterKind: FILTER_KIND, filterName: 'old' }] }; }, 'reattach', 'camera');
  assert.equal(calls[1][0], 'RemoveSourceFilter');
  assert.equal(calls[2][0], 'CreateSourceFilter');
  assert.equal(calls[2][1].filterKind, FILTER_KIND);
});

test('OBS lookup failure stops filter changes', async () => {
  let calls = 0;
  await assert.rejects(manageFilter(async () => { calls++; throw new Error('not found'); }, 'reattach', 'camera'), /not found/);
  assert.equal(calls, 1);
});
