'use strict';

const FILTER_KIND = 'frame_arrival_probe_native';
const FILTER_NAME = '프레임 도착 감지 (네이티브)';

async function manageFilter(request, action, sourceName, filterKind = FILTER_KIND) {
  const { filters } = await request('GetSourceFilterList', { sourceName });
  if (action === 'check') {
    return { filters, ...await request('GetSourceActive', { sourceName }) };
  }
  const existing = filters.filter((filter) => filter.filterKind === filterKind);
  if (action === 'remove' || action === 'reattach') {
    for (const filter of existing) {
      await request('RemoveSourceFilter', { sourceName, filterName: filter.filterName });
    }
  }
  if ((action === 'add' && !existing.length) || action === 'reattach') {
    await request('CreateSourceFilter', { sourceName, filterName: FILTER_NAME, filterKind, filterSettings: {} });
  }
  return { action, sourceName, filterKind };
}

module.exports = { FILTER_KIND, manageFilter };
