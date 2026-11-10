import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { MidiState } from './state';
import { createApi } from './server';
import { startMidi } from './native';
import type { Config } from './types';

export function loadConfig(file?: string | null): Config {
  const config: Config = { port: 19100, deviceName: 'Launchpad MK2', deviceInterface: '', heartbeatTimeoutMs: 1500,
    ...(file ? JSON.parse(fs.readFileSync(file, 'utf8')) : {}) };
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new Error('Invalid port');
  if (typeof config.deviceName !== 'string' || !config.deviceName.trim()) throw new Error('deviceName is required');
  if (typeof config.deviceInterface !== 'string') throw new Error('deviceInterface must be a string');
  if (!Number.isInteger(config.heartbeatTimeoutMs) || config.heartbeatTimeoutMs < 500 || config.heartbeatTimeoutMs > 5000) {
    throw new Error('heartbeatTimeoutMs must be 500..5000');
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
  if (args.length && !(args.length === 2 && args[0] === '--config')) throw new Error('Usage: cli.js [--list | --config FILE]');
  const local = path.join(__dirname, '../../config.local.json');
  const config = loadConfig(args[1] || (fs.existsSync(local) ? local : null));
  const state = new MidiState(config);
  const server = createApi(state);
  let stopMidi = () => {};
  let closing = false;
  function close() {
    if (closing) return;
    closing = true;
    stopMidi();
    server.close();
  }
  server.on('error', (error) => { console.error(error.message); close(); process.exitCode = 1; });
  server.listen(config.port, '127.0.0.1', () => {
    console.log(`MIDI API listening at http://127.0.0.1:${config.port}`);
    stopMidi = startMidi(config, state);
  });
  process.once('SIGINT', close);
  process.once('SIGTERM', close);
}

if (require.main === module) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(String(error)); process.exitCode = 1; }
}
