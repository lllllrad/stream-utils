'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { setTimeout: sleep } = require('node:timers/promises');
const { connect } = require('./obs-client');
const { readHeartbeats } = require('./heartbeat');
const { makeSourceState, reset, observe, recoverSource, isFreshHeartbeat } = require('./monitor');

function createLogger(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  let warned = false;
  return (message) => {
    const line = `[${new Date().toISOString()}] ${message}`;
    console.log(line);
    try { fs.appendFileSync(file, `${line}\n`); }
    catch (error) {
      if (!warned) { console.error(`Cannot write log file: ${error.message}`); warned = true; }
    }
  };
}

async function pollSources(config, request, states, { mode = 'native', log = console.log, now = Date.now,
  heartbeats = () => readHeartbeats(config.heartbeatDir) } = {}) {
  const records = mode === 'native' ? heartbeats() : null;
  const activeSources = new Map();
  // Gather visibility before any recovery so peer evidence does not depend on source order.
  for (const sourceName of config.sources) {
    try { activeSources.set(sourceName, await request('GetSourceActive', { sourceName })); }
    catch (error) {
      reset(states.get(sourceName));
      log(`[${sourceName}] ${error.message}`);
    }
  }
  for (const sourceName of config.sources) {
    const state = states.get(sourceName);
    if (now() < state.cooldownUntil || !activeSources.has(sourceName)) continue;
    try {
      const active = activeSources.get(sourceName);
      const { videoShowing } = active;
      let sample;
      if (mode === 'native') sample = { heartbeat: records.get(sourceName) || null };
      else if (videoShowing) {
        const { imageData } = await request('GetSourceScreenshot', { sourceName, imageFormat: 'png' });
        if (typeof imageData !== 'string' || !imageData.startsWith('data:image/png;base64,')) throw new Error('Invalid screenshot');
        sample = { value: createHash('sha256').update(Buffer.from(imageData.split(',')[1], 'base64')).digest('hex') };
      }
      const observedAt = now();
      const healthyPeers = mode === 'native' ? config.sources.filter((peer) => peer !== sourceName
        && activeSources.get(peer)?.videoShowing === true
        && isFreshHeartbeat(records.get(peer), observedAt, config.staleWarnMs)) : [];
      const action = observe(state, { ...sample, showing: videoShowing === true, now: observedAt,
        healthyPeer: healthyPeers.length > 0 }, config);
      if (action === 'missing' || action === 'stale') log(`[${sourceName}] heartbeat ${action}; check the native filter and directory`);
      if (action === 'stale-blocked') log(`[${sourceName}] stale recovery blocked; no visible monitored source has a fresh heartbeat`);
      if (action === 'recover') {
        const heartbeat = sample?.heartbeat;
        log(`[${sourceName}] recovery evidence ${JSON.stringify({ reason: state.recoveryReason,
          heartbeat: heartbeat ? { count: String(heartbeat.count), writtenAt: heartbeat.writtenAt,
            ageMs: observedAt - heartbeat.writtenAt * 1000 } : null,
          videoActive: active.videoActive, videoShowing, healthyPeers })}`);
        if (config.dryRun) {
          log(`[${sourceName}] dry-run: would request recovery; cooldown applied`);
          continue;
        }
        log(`[${sourceName}] ${state.recoveryReason}; requesting recovery`);
        try { await recoverSource(request, sourceName); log(`[${sourceName}] recovery request completed`); }
        finally { state.cooldownUntil = now() + config.recoveryCooldownMs; }
      }
    } catch (error) {
      reset(state);
      log(`[${sourceName}] ${error.message}`);
    }
  }
}

async function watch(config, { mode = 'native', signal, log = createLogger(config.logFile), connector = connect } = {}) {
  if (!config.sources.length) throw new Error('Configure at least one source in config.local.json before watching');
  log(`Watchdog started (${mode}, dryRun=${Boolean(config.dryRun)}): ${config.sources.join(', ')}`);
  try {
    while (!signal?.aborted) {
      let client;
      try {
        client = await connector(config, { signal });
        log('Connected to OBS');
        const states = new Map(config.sources.map((name) => [name, makeSourceState()]));
        while (!signal?.aborted && client.ws.readyState === 1) {
          await pollSources(config, client.request, states, { mode, log });
          await sleep(config.pollIntervalMs, undefined, { signal });
        }
      } catch (error) { if (!signal?.aborted) log(error.message); }
      finally { client?.close(); }
      if (!signal?.aborted) await sleep(config.reconnectDelayMs, undefined, { signal });
    }
  } catch (error) { if (!signal?.aborted) throw error; }
  log('Watchdog stopped');
}

module.exports = { createLogger, pollSources, watch };
