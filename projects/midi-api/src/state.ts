import type { MidiDevice, MidiEvent } from './types';

export class MidiState {
  private readonly now: () => number;
  private readonly timeout: number;
  private connected: boolean;
  private device: MidiDevice | null;
  devices: MidiDevice[];
  private readonly pressed: Set<string>;
  private lastHeartbeat: number | null;
  private lastError: string | null;
  lastWarudoRequestAt: string | null;
  constructor({ heartbeatTimeoutMs = 1500, now = Date.now } = {}) {
    this.now = now;
    this.timeout = heartbeatTimeoutMs;
    this.connected = false;
    this.device = null;
    this.devices = [];
    this.pressed = new Set();
    this.lastHeartbeat = null;
    this.lastError = null;
    this.lastWarudoRequestAt = null;
  }

  accept(event: MidiEvent): void {
    switch (event.type) {
      case 'devices':
        this.devices = event.devices;
        break;
      case 'connected':
        this.disconnect();
        this.connected = true;
        this.device = event.device;
        this.lastHeartbeat = this.now();
        this.lastError = null;
        break;
      case 'heartbeat':
        if (this.connected) this.lastHeartbeat = this.now();
        break;
      case 'midi': {
        if (!this.isFresh()) { this.disconnect(); break; }
        const { status, data1, data2 } = event;
        if (![status, data1, data2].every(Number.isInteger) ||
            status < 128 || status > 255 || data1 < 0 || data1 > 127 || data2 < 0 || data2 > 127) break;
        const kind = status & 0xf0;
        // MK2 grid and round buttons use notes; the top row uses CC 104..111.
        // Do not gate on clock, aftertouch, program changes, or unrelated CCs.
        if (![0x80, 0x90, 0xb0].includes(kind)) break;
        if (kind === 0xb0 && (data1 < 104 || data1 > 111)) {
          if (data1 === 120 || data1 === 123) this.pressed.clear();
          break;
        }
        const key = `${kind === 0xb0 ? 'cc' : 'note'}:${status & 15}:${data1}`;
        if (kind === 0x80 || data2 === 0) this.pressed.delete(key);
        else this.pressed.add(key);
        break;
      }
      case 'error':
        this.lastError = event.message;
        this.disconnect();
        break;
      case 'disconnected':
        this.disconnect();
        break;
      default:
        break;
    }
  }

  isFresh() {
    return this.connected && this.lastHeartbeat !== null && this.now() - this.lastHeartbeat < this.timeout;
  }

  disconnect() {
    this.connected = false;
    this.pressed.clear();
    this.lastHeartbeat = null;
  }

  snapshot() {
    // A stale helper cannot re-enable a held button merely by sending a heartbeat later.
    if (this.connected && !this.isFresh()) this.disconnect();
    return {
      schemaVersion: 1,
      connected: this.connected,
      trackingEnabled: this.connected && this.pressed.size > 0,
      pressedCount: this.pressed.size,
      pressed: [...this.pressed].sort(),
      device: this.device,
      lastError: this.lastError,
      lastWarudoRequestAt: this.lastWarudoRequestAt,
    };
  }
}
