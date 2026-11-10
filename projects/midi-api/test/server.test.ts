import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { MidiState } from '../src/state';
import { createApi } from '../src/server';

test('real local HTTP responses reflect fake MIDI holds, release and lost connection', async (t) => {
  const state = new MidiState();
  const server = createApi(state);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise<void>((resolve) => { server.closeAllConnections(); server.close(() => resolve()); }));
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  const device = { id: 0, name: 'Launchpad MK2', deviceInterface: 'red-device' };
  state.accept({ type: 'devices', devices: [device] });
  state.accept({ type: 'connected', device });
  state.accept({ type: 'midi', status: 0x90, data1: 11, data2: 127 });
  const held = await fetch(`${origin}/v1/state?consumer=warudo`);
  assert.equal(held.headers.get('cache-control'), 'no-store');
  const body = await held.json() as { trackingEnabled: boolean; lastWarudoRequestAt: string };
  assert.equal(body.trackingEnabled, true);
  assert.ok(body.lastWarudoRequestAt);
  state.accept({ type: 'midi', status: 0x80, data1: 11, data2: 0 });
  assert.equal(((await (await fetch(`${origin}/v1/state`)).json()) as { trackingEnabled: boolean }).trackingEnabled, false);
  state.disconnect();
  assert.deepEqual(await (await fetch(`${origin}/health`)).json(), { ok: true, midiConnected: false });
  assert.deepEqual(await (await fetch(`${origin}/v1/devices`)).json(), { devices: [device] });
  assert.equal((await fetch(`${origin}/v1/state`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${origin}/unknown`)).status, 404);
});
