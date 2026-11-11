import { connectObs, type ObsConnection } from './obs-client';
import type { ObsConfig } from './types';
import type { MidiState } from './state';

export interface ObsPttStatus {
  enabled: boolean;
  connected: boolean;
  armed: boolean;
  inputName: string | null;
  lastError: string | null;
}

export function startObsPtt(config: ObsConfig, password: string, state: MidiState, {
  connect = connectObs,
  log = console.error,
  pollMs = 20,
  status = { enabled: true, connected: false, armed: false, inputName: config.inputName, lastError: null } as ObsPttStatus,
} = {}): { status: ObsPttStatus; stop(): Promise<void> } {
  Object.assign(status, { enabled: true, connected: false, armed: false, inputName: config.inputName, lastError: null });
  let stopping = false;
  let wake: (() => void) | undefined;
  const pause = (ms: number) => new Promise<void>((resolve) => {
    const timer = setTimeout(() => { wake = undefined; resolve(); }, ms);
    wake = () => { clearTimeout(timer); wake = undefined; resolve(); };
  });
  const run = (async () => {
    while (!stopping) {
      let client: ObsConnection | undefined;
      let inputVerified = false;
      try {
        client = await connect(config, password);
        // Explicit source only: never infer or manipulate an arbitrary live audio input.
        await client.request('GetInputMute', { inputName: config.inputName });
        inputVerified = true;
        await client.request('SetInputMute', { inputName: config.inputName, inputMuted: true });
        status.connected = true;
        status.armed = false;
        status.lastError = null;
        let appliedMuted = true;
        let lastSetAt = Date.now();
        while (!stopping && client.isOpen) {
          const held = state.snapshot().trackingEnabled;
          // Starting/reconnecting while a pad is held cannot unexpectedly open the microphone.
          if (!held) status.armed = true;
          const desiredMuted = !(held && status.armed);
          if (desiredMuted !== appliedMuted || Date.now() - lastSetAt >= 500) {
            await client.request('SetInputMute', { inputName: config.inputName, inputMuted: desiredMuted });
            appliedMuted = desiredMuted;
            lastSetAt = Date.now();
            // Re-read current MIDI state before sending another command; requests never overlap.
            continue;
          }
          await pause(pollMs);
        }
      } catch (error) {
        status.lastError = String(error);
        log(`OBS push-to-talk: ${String(error)}`);
      } finally {
        status.connected = false;
        status.armed = false;
        if (client?.isOpen && inputVerified) {
          try { await client.request('SetInputMute', { inputName: config.inputName, inputMuted: true }); }
          catch { log('OBS push-to-talk: final mute could not be confirmed'); }
        }
        client?.close();
      }
      if (!stopping) await pause(config.reconnectDelayMs);
    }
  })();
  return { status, async stop() { stopping = true; wake?.(); await run; status.enabled = false; } };
}
