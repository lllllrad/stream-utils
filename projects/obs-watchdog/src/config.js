'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const projectDir = path.resolve(__dirname, '..');

function loadConfig(env = process.env, file = env.OBS_WATCHDOG_CONFIG || path.join(projectDir, 'config.local.json')) {
  const full = path.resolve(file);
  const explicit = Boolean(env.OBS_WATCHDOG_CONFIG) || arguments.length > 1;
  const local = fs.existsSync(full) ? JSON.parse(fs.readFileSync(full, 'utf8')) : {};
  if (explicit && !fs.existsSync(full)) throw new Error(`Configuration file not found: ${full}`);
  const allowed = ['host', 'port', 'sources', 'heartbeatDir', 'logFile', 'pollIntervalMs', 'freezeThresholdChecks',
    'staleWarnMs', 'recoveryCooldownMs', 'reconnectDelayMs', 'requestTimeoutMs', 'connectTimeoutMs'];
  for (const key of Object.keys(local)) {
    if (!allowed.includes(key)) throw new Error(`Unknown configuration key: ${key}`);
  }
  const config = {
    host: '127.0.0.1', port: 4455, sources: [],
    heartbeatDir: path.join(os.tmpdir(), 'obs-watchdog'),
    logFile: path.join(projectDir, 'watchdog.log'),
    pollIntervalMs: 500, freezeThresholdChecks: 3, staleWarnMs: 5000,
    recoveryCooldownMs: 30000, reconnectDelayMs: 5000, requestTimeoutMs: 5000, connectTimeoutMs: 5000,
    ...local,
    password: env.OBS_WS_PASSWORD || '',
  };
  if (env.OBS_WS_HOST !== undefined) config.host = env.OBS_WS_HOST;
  if (env.OBS_WS_PORT !== undefined) config.port = Number(env.OBS_WS_PORT);
  if (env.OBS_HEARTBEAT_DIR !== undefined) config.heartbeatDir = env.OBS_HEARTBEAT_DIR;
  if (typeof config.host !== 'string' || !config.host.trim() || /[\s/?#@]/u.test(config.host)) {
    throw new Error('host must be a hostname or IP address');
  }
  for (const key of ['port', 'pollIntervalMs', 'freezeThresholdChecks', 'staleWarnMs',
    'recoveryCooldownMs', 'reconnectDelayMs', 'requestTimeoutMs', 'connectTimeoutMs']) {
    if (!Number.isSafeInteger(config[key]) || config[key] <= 0) throw new Error(`${key} must be a positive integer`);
  }
  if (config.port > 65535) throw new Error('port must be at most 65535');
  if (config.freezeThresholdChecks < 2) throw new Error('freezeThresholdChecks must be at least 2');
  if (!Array.isArray(config.sources) || config.sources.some((name) => typeof name !== 'string' || !name.trim() || /[\t\r\n]/u.test(name))) {
    throw new Error('sources must be an array of non-empty source names without tabs or newlines');
  }
  config.sources = [...new Set(config.sources)];
  for (const key of ['heartbeatDir', 'logFile']) {
    if (typeof config[key] !== 'string' || !config[key].trim()) throw new Error(`${key} must be a non-empty path`);
    config[key] = path.resolve(path.dirname(full), config[key]);
  }
  return config;
}

module.exports = { loadConfig, projectDir };
