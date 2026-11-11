import test from 'node:test';
import assert from 'node:assert/strict';
import { MidiState } from '../src/state';
import { startObsPtt } from '../src/obs-ptt';
import type { ObsConnection } from '../src/obs-client';
import type { ObsConfig } from '../src/types';

const config: ObsConfig = { host: '127.0.0.1', port: 4455, inputName: 'Test microphone', connectTimeoutMs: 100, requestTimeoutMs: 100, reconnectDelayMs: 5 };
const device = { id: 1, name: '2 - Launchpad MK2', deviceInterface: 'blue' };
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 2000;
  while (!predicate()) { assert.ok(Date.now() < deadline, 'Timed out waiting for fake OBS'); await delay(2); }
}
function press(state: MidiState, held: boolean): void { state.accept({ type: 'midi', status: 0x90, data1: 11, data2: held ? 127 : 0 }); }
class FakeObs implements ObsConnection {
  isOpen = true;
  requests: Array<{ type: string; data: Record<string, unknown> }> = [];
  blockUnmute?: () => Promise<void>;
  failLookup = false;
  async request(type: string, data: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    this.requests.push({ type, data });
    if (type === 'GetInputMute' && this.failLookup) throw new Error('No such input');
    if (type === 'SetInputMute' && data.inputMuted === false) await this.blockUnmute?.();
    return { inputMuted: true };
  }
  close(): void { this.isOpen = false; }
  mutes(): boolean[] { return this.requests.filter((r) => r.type === 'SetInputMute').map((r) => r.data.inputMuted as boolean); }
}

test('PTT waits for release on startup, then follows only blue MIDI; loss and shutdown mute the explicit source', async (t) => {
  const blue = new MidiState();
  const red = new MidiState();
  blue.accept({ type: 'connected', device });
  red.accept({ type: 'connected', device: { ...device, id: 0, name: 'Launchpad MK2' } });
  press(blue, true);
  const obs = new FakeObs();
  const control = startObsPtt(config, '', blue, { connect: async () => obs, pollMs: 2, log: () => {} });
  t.after(() => control.stop());
  await until(() => control.status.connected);
  assert.deepEqual(obs.mutes(), [true]);
  assert.equal(control.status.armed, false);
  press(blue, false);
  await until(() => control.status.armed);
  press(red, true);
  await delay(10);
  assert.deepEqual(obs.mutes(), [true]);
  press(blue, true);
  await until(() => obs.mutes().at(-1) === false);
  blue.accept({ type: 'error', message: 'Input lost' });
  await until(() => obs.mutes().at(-1) === true);
  blue.accept({ type: 'connected', device });
  press(blue, true);
  await until(() => obs.mutes().at(-1) === false);
  await control.stop();
  assert.equal(obs.mutes().at(-1), true);
  assert.ok(obs.requests.every((request) => ['GetInputMute', 'SetInputMute'].includes(request.type) && request.data.inputName === config.inputName));
});

test('release during an in-flight unmute is serialized and followed by mute', async (t) => {
  const blue = new MidiState();
  blue.accept({ type: 'connected', device });
  const obs = new FakeObs();
  let releaseUnmute: (() => void) | undefined;
  obs.blockUnmute = () => new Promise<void>((resolve) => { releaseUnmute = resolve; });
  const control = startObsPtt(config, '', blue, { connect: async () => obs, pollMs: 2, log: () => {} });
  t.after(() => control.stop());
  await until(() => control.status.armed);
  press(blue, true);
  await until(() => releaseUnmute !== undefined);
  press(blue, false);
  await delay(10);
  assert.deepEqual(obs.mutes(), [true, false]);
  releaseUnmute!();
  await until(() => obs.mutes().at(-1) === true);
  assert.deepEqual(obs.mutes(), [true, false, true]);
});

test('OBS reconnect while held remains muted until a fresh release and press', async (t) => {
  const blue = new MidiState();
  blue.accept({ type: 'connected', device });
  const first = new FakeObs();
  const second = new FakeObs();
  let connects = 0;
  const control = startObsPtt(config, '', blue, { connect: async () => ++connects === 1 ? first : second, pollMs: 2, log: () => {} });
  t.after(() => control.stop());
  await until(() => control.status.armed);
  press(blue, true);
  await until(() => first.mutes().at(-1) === false);
  first.close();
  await until(() => connects === 2 && control.status.connected);
  assert.deepEqual(second.mutes(), [true]);
  assert.equal(control.status.armed, false);
  press(blue, false);
  await until(() => control.status.armed);
  press(blue, true);
  await until(() => second.mutes().at(-1) === false);
});

test('a missing configured microphone never falls back to another source or changes mute state', async (t) => {
  const obs = new FakeObs();
  obs.failLookup = true;
  const control = startObsPtt({ ...config, reconnectDelayMs: 10000 }, '', new MidiState(), { connect: async () => obs, pollMs: 2, log: () => {} });
  t.after(() => control.stop());
  await until(() => control.status.lastError !== null);
  assert.deepEqual(obs.requests.map((r) => r.type), ['GetInputMute']);
  assert.deepEqual(obs.mutes(), []);
});
