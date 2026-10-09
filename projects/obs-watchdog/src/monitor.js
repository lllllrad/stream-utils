'use strict';

function makeSourceState() {
  return { lastValue: null, filePath: null, matches: 0, cooldownUntil: 0, warned: null };
}

function reset(state) {
  state.lastValue = null;
  state.matches = 0;
}

// Keep detection independent of OBS and the filesystem so timing is deterministic in tests.
function observe(state, { showing, heartbeat, value, now }, config) {
  if (!showing) { reset(state); state.warned = null; return 'hidden'; }
  if (now < state.cooldownUntil) return 'cooldown';
  if (heartbeat !== undefined) {
    const warning = !heartbeat ? 'missing' : now - heartbeat.writtenAt * 1000 > config.staleWarnMs || heartbeat.writtenAt * 1000 > now + 1000 ? 'stale' : null;
    if (warning) {
      reset(state);
      const repeated = state.warned === warning;
      state.warned = warning;
      return repeated ? 'waiting' : warning;
    }
    if (state.filePath !== heartbeat.filePath) reset(state);
    state.filePath = heartbeat.filePath;
    value = heartbeat.count;
  }
  state.warned = null;
  state.matches = state.lastValue === value ? state.matches + 1 : 1;
  state.lastValue = value;
  if (state.matches < config.freezeThresholdChecks) return 'healthy';
  reset(state);
  state.cooldownUntil = now + config.recoveryCooldownMs;
  return 'recover';
}

async function recoverSource(request, sourceName) {
  const { inputSettings } = await request('GetInputSettings', { inputName: sourceName });
  if (!inputSettings || typeof inputSettings !== 'object') throw new Error('OBS returned invalid input settings');
  await request('SetInputSettings', { inputName: sourceName, inputSettings, overlay: true });
}

module.exports = { makeSourceState, reset, observe, recoverSource };
