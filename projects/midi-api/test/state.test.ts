import test from 'node:test';
import assert from 'node:assert/strict';
import { MidiState } from '../src/state';

const device = { id: 0, name: 'Launchpad MK2', deviceInterface: 'red-device' };
function connect(state: MidiState): void { state.accept({ type: 'connected', device }); }
function midi(state: MidiState, status: number, data1: number, data2: number): void {
  state.accept({ type: 'midi', status, data1, data2 });
}

test('momentary gate counts multiple pads, duplicate presses, velocity-zero and note-off releases', () => {
  const state = new MidiState();
  connect(state);
  assert.equal(state.snapshot().trackingEnabled, false);
  midi(state, 0x90, 11, 127);
  midi(state, 0x90, 11, 127);
  midi(state, 0x90, 12, 100);
  assert.equal(state.snapshot().pressedCount, 2);
  midi(state, 0x80, 11, 64);
  assert.equal(state.snapshot().trackingEnabled, true);
  midi(state, 0x90, 12, 0);
  assert.equal(state.snapshot().trackingEnabled, false);
});

test('top round buttons use CC; channels remain independent; unrelated messages do not enable the gate', () => {
  const state = new MidiState();
  connect(state);
  midi(state, 0xa0, 11, 127);
  midi(state, 0xb0, 7, 127);
  midi(state, 0xf8, 0, 0);
  assert.equal(state.snapshot().trackingEnabled, false);
  midi(state, 0xb0, 104, 127);
  midi(state, 0x91, 11, 127);
  midi(state, 0x90, 11, 0);
  midi(state, 0xb0, 104, 0);
  assert.equal(state.snapshot().pressedCount, 1);
  midi(state, 0x81, 11, 0);
  assert.equal(state.snapshot().trackingEnabled, false);
});

test('helper failure, unplug and heartbeat expiration clear held buttons; reconnect never restores old holds', () => {
  let clock = 100;
  const state = new MidiState({ now: () => clock, heartbeatTimeoutMs: 1500 });
  connect(state);
  midi(state, 0x90, 11, 127);
  clock += 1500;
  assert.equal(state.snapshot().trackingEnabled, false);
  state.accept({ type: 'heartbeat' });
  assert.equal(state.snapshot().connected, false);
  connect(state);
  assert.equal(state.snapshot().pressedCount, 0);
  midi(state, 0x90, 11, 127);
  state.accept({ type: 'error', message: 'input overflow' });
  assert.equal(state.snapshot().trackingEnabled, false);
  connect(state);
  midi(state, 0x90, 11, 127);
  state.accept({ type: 'disconnected' });
  assert.equal(state.snapshot().pressedCount, 0);
});

test('malformed MIDI and messages received before connect cannot open the gate', () => {
  const state = new MidiState();
  midi(state, 0x90, 11, 127);
  assert.equal(state.snapshot().trackingEnabled, false);
  connect(state);
  midi(state, 0x90, 11, 128);
  midi(state, 0x90, -1, 127);
  midi(state, 0x90, 11, Number.NaN);
  assert.equal(state.snapshot().trackingEnabled, false);
  midi(state, 0x90, 11, 127);
  midi(state, 0xb0, 123, 0);
  assert.equal(state.snapshot().trackingEnabled, false);
});
