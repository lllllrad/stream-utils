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
  microphone: { deviceName: string; deviceInterface: string } | null;
  obs: ObsConfig | null;
}
export interface ObsConfig {
  host: string;
  port: number;
  inputName: string;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  reconnectDelayMs: number;
}
export type MidiEvent =
  | { type: 'identified'; trackingDevice: string }
  | { type: 'devices'; devices: MidiDevice[] }
  | { type: 'connected'; device: MidiDevice }
  | { type: 'heartbeat' }
  | { type: 'midi'; status: number; data1: number; data2: number }
  | { type: 'error'; message: string }
  | { type: 'disconnected' };
