import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MidiState } from './state';
import { createApi } from './server';
import { startMidi } from './native';
import { startObsPtt, type ObsPttStatus } from './obs-ptt';
import type { Config } from './types';

export function loadConfig(file?: string | null): Config {
  const config: Config = { port: 19100, deviceName: 'Launchpad MK2', deviceInterface: '', heartbeatTimeoutMs: 1500, microphone: null, obs: null,
    ...(file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}) };
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('Invalid port');
  if (typeof config.deviceName !== 'string' || !config.deviceName.trim()) throw new Error('deviceName is required');
  if (typeof config.deviceInterface !== 'string') throw new Error('deviceInterface must be a string');
  if (!Number.isInteger(config.heartbeatTimeoutMs) || config.heartbeatTimeoutMs < 500 || config.heartbeatTimeoutMs > 5000) {
    throw new Error('heartbeatTimeoutMs must be 500..5000');
  }
  if (config.microphone !== null) {
    if (typeof config.microphone !== 'object' || typeof config.microphone.deviceName !== 'string' || !config.microphone.deviceName.trim() ||
      typeof config.microphone.deviceInterface !== 'string') throw new Error('Invalid microphone MIDI selection');
    const sameDevice = config.microphone.deviceInterface && config.deviceInterface ?
      config.microphone.deviceInterface === config.deviceInterface : config.microphone.deviceName === config.deviceName;
    if (sameDevice) {
      throw new Error('Tracking and microphone must select different MIDI devices');
    }
  }
  if (config.obs !== null) {
    const obs = config.obs;
    if (typeof obs !== 'object' || typeof obs.inputName !== 'string' || !obs.inputName.trim() ||
      !['127.0.0.1', 'localhost', '::1'].includes(obs.host)) throw new Error('OBS requires an explicit input name and a loopback host');
    for (const key of ['port', 'connectTimeoutMs', 'requestTimeoutMs', 'reconnectDelayMs'] as const) {
      if (!Number.isSafeInteger(obs[key]) || obs[key] <= 0) throw new Error(`Invalid OBS ${key}`);
    }
    if (obs.port > 65535 || obs.connectTimeoutMs > 30000 || obs.requestTimeoutMs > 30000 || obs.reconnectDelayMs > 60000) throw new Error('Invalid OBS timing or port');
  }
  return config;
}

function main(args: string[]): void {
  if (process.platform !== 'win32') throw new Error('MIDI input currently requires Windows');
  if (args.length === 1 && args[0] === '--list') {
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
      path.join(__dirname, '../../native/midi.ps1'), '-List'], { stdio: 'inherit', windowsHide: true });
    process.exitCode = result.status ?? 1;
    return;
  }
  const options = parseArgs(args);
  const local = path.join(__dirname, '../../config.local.json');
  const config = loadConfig(options.configFile || (fs.existsSync(local) ? local : null));
  if (options.enableObs && (!config.obs || !config.microphone)) throw new Error('OBS control requires explicit obs and microphone configuration');
  const state = new MidiState(config);
  const microphone = config.microphone ? new MidiState(config) : undefined;
  const obsStatus: ObsPttStatus = { enabled: false, connected: false, armed: false, inputName: config.obs?.inputName ?? null, lastError: null };
  const server = createApi(state, microphone, obsStatus);
  let stopMidi = () => {};
  let stopMicrophone = () => {};
  let obsControl: ReturnType<typeof startObsPtt> | undefined;
  let closing = false;
  async function close(): Promise<void> {
    if (closing) return;
    closing = true;
    stopMidi();
    stopMicrophone();
    await obsControl?.stop();
    server.close();
  }
  server.on('error', (error) => { console.error(error.message); void close(); process.exitCode = 1; });
  server.listen(config.port, '127.0.0.1', () => {
    console.log(`MIDI API listening at http://127.0.0.1:${config.port}`);
    stopMidi = startMidi(config, state, { identify: true });
    if (microphone && config.microphone) stopMicrophone = startMidi({ ...config, ...config.microphone }, microphone);
    if (options.enableObs && config.obs && microphone) {
      obsControl = startObsPtt(config.obs, process.env.OBS_WS_PASSWORD ?? '', microphone, { status: obsStatus });
      console.log(`OBS microphone control ENABLED for: ${config.obs.inputName}`);
    } else console.log('OBS microphone control DISABLED (requires --enable-obs-microphone)');
  });
  process.once('SIGINT', () => { void close(); });
  process.once('SIGTERM', () => { void close(); });
}

export function parseArgs(args: string[]): { configFile?: string; enableObs: boolean } {
  let configFile: string | undefined;
  let enableObs = false;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--enable-obs-microphone' && !enableObs) enableObs = true;
    else if (arg === '--config' && !configFile && args[index + 1] && !args[index + 1]!.startsWith('--')) configFile = args[++index];
    else throw new Error('Usage: cli.js [--list | --config FILE] [--enable-obs-microphone]');
  }
  return { configFile, enableObs };
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
