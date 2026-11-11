import path from 'node:path';
import readline from 'node:readline';
import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import type { Config, MidiEvent } from './types';
import type { MidiState } from './state';

export function startMidi(config: Config, state: MidiState, { log = console.error, identify = false } = {}): () => void {
  let child: ChildProcessByStdio<null, Readable, Readable>;
  let timer: NodeJS.Timeout | undefined;
  let stopped = false;
  function connect() {
    child = spawn('powershell.exe', [
      '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, '../../native/midi.ps1'),
      '-DeviceName', config.deviceName, '-DeviceInterface', config.deviceInterface,
      ...(identify ? ['-Identify'] : []),
    ], { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const lines = readline.createInterface({ input: child.stdout });
    lines.on('line', (line) => {
      try {
        const event = JSON.parse(line) as MidiEvent;
        state.accept(event);
        if (['connected', 'disconnected', 'error', 'identified'].includes(event.type)) log(JSON.stringify(event));
      } catch (error) {
        log(`Invalid MIDI helper event: ${String(error)}`);
        state.accept({ type: 'error', message: 'Invalid MIDI helper event' });
        child.kill();
      }
    });
    child.stderr.on('data', (data) => log(String(data).trim()));
    child.on('error', (error) => state.accept({ type: 'error', message: error.message }));
    child.on('close', () => {
      lines.close();
      state.disconnect();
      if (!stopped) timer = setTimeout(connect, 2000);
    });
  }
  connect();
  return () => { stopped = true; clearTimeout(timer); state.disconnect(); child?.kill(); };
}
