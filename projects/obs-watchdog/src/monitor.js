'use strict';

function makeSourceState() {
  return { lastValue: null, filePath: null, matches: 0, cooldownUntil: 0, warned: null,
    staleSince: null, staleKey: null, recoveryReason: null };
}

function reset(state) {
  state.lastValue = null;
  state.matches = 0;
  state.staleSince = null;
  state.staleKey = null;
  state.recoveryReason = null;
}

function isFreshHeartbeat(heartbeat, now, staleWarnMs) {
  return Boolean(heartbeat && now - heartbeat.writtenAt * 1000 <= staleWarnMs
    && heartbeat.writtenAt * 1000 <= now + 1000);
}

// Keep detection independent of OBS and the filesystem so timing is deterministic in tests.
function observe(state, { showing, heartbeat, value, now, healthyPeer = false }, config) {
  if (!showing) { reset(state); state.warned = null; return 'hidden'; }
  if (now < state.cooldownUntil) return 'cooldown';
  if (heartbeat !== undefined) {
    const warning = !heartbeat ? 'missing' : !isFreshHeartbeat(heartbeat, now, config.staleWarnMs) ? 'stale' : null;
    if (warning) {
      const staleKey = heartbeat ? `${heartbeat.filePath}:${heartbeat.writtenAt}:${heartbeat.count}` : null;
      const staleSince = state.staleKey === staleKey ? state.staleSince : null;
      reset(state);
      let action = warning;
      if (warning === 'stale' && now - heartbeat.writtenAt * 1000 > config.staleWarnMs) {
        state.staleSince = staleSince ?? now;
        state.staleKey = staleKey;
        if (now - state.staleSince >= config.staleRecoverMs
          && now - heartbeat.writtenAt * 1000 >= config.staleRecoverMs) {
          if (healthyPeer) {
            reset(state);
            state.warned = null;
            state.recoveryReason = 'stale';
            state.cooldownUntil = now + config.recoveryCooldownMs;
            return 'recover';
          }
          action = 'stale-blocked';
        }
      }
      const repeated = state.warned === action;
      state.warned = action;
      return repeated ? 'waiting' : action;
    }
    state.staleSince = null;
    state.staleKey = null;
    if (state.filePath !== heartbeat.filePath) reset(state);
    state.filePath = heartbeat.filePath;
    value = heartbeat.count;
  }
  state.warned = null;
  state.matches = state.lastValue === value ? state.matches + 1 : 1;
  state.lastValue = value;
  if (state.matches < config.freezeThresholdChecks) return 'healthy';
  reset(state);
  state.recoveryReason = 'frozen';
  state.cooldownUntil = now + config.recoveryCooldownMs;
  return 'recover';
}

async function recoverSource(request, sourceName) {
  const { inputSettings } = await request('GetInputSettings', { inputName: sourceName });
  if (!inputSettings || typeof inputSettings !== 'object') throw new Error('OBS returned invalid input settings');
  await request('SetInputSettings', { inputName: sourceName, inputSettings, overlay: true });
}

module.exports = { makeSourceState, reset, observe, recoverSource, isFreshHeartbeat };
