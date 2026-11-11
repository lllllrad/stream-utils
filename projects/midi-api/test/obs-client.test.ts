import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { connectObs, type ObsSocket } from '../src/obs-client';
import type { ObsConfig } from '../src/types';

const config: ObsConfig = { host: '127.0.0.1', port: 4455, inputName: 'Fake microphone', connectTimeoutMs: 100, requestTimeoutMs: 100, reconnectDelayMs: 5 };
type Listener = ((event: { data: unknown }) => void) | (() => void) | ((event: { code?: number }) => void);
class FakeSocket implements ObsSocket {
  readyState = 1;
  sent: string[] = [];
  listeners = new Map<string, Listener[]>();
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'error', listener: () => void): void;
  addEventListener(type: 'close', listener: (event: { code?: number }) => void): void;
  addEventListener(type: string, listener: Listener): void { this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]); }
  emit(type: string, value: unknown): void {
    for (const listener of this.listeners.get(type) ?? []) (listener as (event: unknown) => void)(value);
  }
  message(value: unknown): void { this.emit('message', { data: JSON.stringify(value) }); }
  send(value: string): void { this.sent.push(value); }
  close(): void { this.readyState = 3; this.emit('close', { code: 1000 }); }
}

test('OBS authentication is sent before requests; mute RPC responses match the request ID', async () => {
  const socket = new FakeSocket();
  const pending = connectObs(config, 'test-password', { createSocket: () => socket });
  socket.message({ op: 0, d: { rpcVersion: 1, authentication: { salt: 'salt', challenge: 'challenge' } } });
  const secret = createHash('sha256').update('test-passwordsalt').digest('base64');
  const expected = createHash('sha256').update(secret + 'challenge').digest('base64');
  assert.deepEqual(JSON.parse(socket.sent[0]!), { op: 1, d: { rpcVersion: 1, eventSubscriptions: 0, authentication: expected } });
  socket.message({ op: 2, d: { negotiatedRpcVersion: 1 } });
  const client = await pending;
  const request = client.request('SetInputMute', { inputName: config.inputName, inputMuted: true });
  const outgoing = JSON.parse(socket.sent[1]!) as { d: { requestId: string; requestData: object } };
  assert.deepEqual(outgoing.d.requestData, { inputName: config.inputName, inputMuted: true });
  socket.message({ op: 7, d: { requestId: outgoing.d.requestId, requestStatus: { result: true }, responseData: { acknowledged: true } } });
  assert.deepEqual(await request, { acknowledged: true });
  client.close();
  assert.equal(client.isOpen, false);
});

test('OBS request rejection does not falsely acknowledge a mute', async () => {
  const socket = new FakeSocket();
  const pending = connectObs(config, '', { createSocket: () => socket });
  socket.message({ op: 0, d: { rpcVersion: 1 } });
  socket.message({ op: 2, d: { negotiatedRpcVersion: 1 } });
  const client = await pending;
  const request = client.request('SetInputMute', { inputName: config.inputName, inputMuted: true });
  const failed = assert.rejects(request, /OBS request rejected/);
  const outgoing = JSON.parse(socket.sent[1]!) as { d: { requestId: string } };
  socket.message({ op: 7, d: { requestId: outgoing.d.requestId, requestType: 'SetInputMute', requestStatus: { result: false, code: 600 } } });
  await failed;
  client.close();
});

test('an unresponsive OBS server times out and closes the socket', async () => {
  const socket = new FakeSocket();
  const pending = connectObs({ ...config, requestTimeoutMs: 10 }, '', { createSocket: () => socket });
  socket.message({ op: 0, d: { rpcVersion: 1 } });
  socket.message({ op: 2, d: { negotiatedRpcVersion: 1 } });
  const client = await pending;
  await assert.rejects(client.request('GetInputMute', { inputName: config.inputName }), /timed out/);
  assert.equal(client.isOpen, false);
  assert.equal(socket.readyState, 3);
});

test('missing authentication and malformed handshakes close before any mute can be sent', async () => {
  for (const hello of [
    { op: 0, d: { rpcVersion: 1, authentication: { salt: 's', challenge: 'c' } } },
    { op: 0, d: { rpcVersion: 0 } },
    { op: 2, d: { negotiatedRpcVersion: 1 } },
  ]) {
    const socket = new FakeSocket();
    const pending = connectObs(config, '', { createSocket: () => socket });
    const failed = assert.rejects(pending);
    socket.message(hello);
    await failed;
    assert.deepEqual(socket.sent, []);
    assert.equal(socket.readyState, 3);
  }
});
