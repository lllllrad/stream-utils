export interface MidiDevice {
  id: number;
  name: string;
  deviceInterface: string;
}
export interface Config {
  port: number;
  deviceName: string;
  deviceInterface: string;
  heartbeatTimeoutMs: number;
}
export type MidiEvent =
  | { type: 'devices'; devices: MidiDevice[] }
  | { type: 'connected'; device: MidiDevice }
  | { type: 'heartbeat' }
  | { type: 'midi'; status: number; data1: number; data2: number }
  | { type: 'error'; message: string }
  | { type: 'disconnected' };
