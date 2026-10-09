'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { authentication, connect } = require('../src/obs-client');

const config = { host: '127.0.0.1', port: 4455, password: 'test-only', connectTimeoutMs: 200, requestTimeoutMs: 200 };

class FakeSocket extends EventTarget {
  static last;
  constructor(url) { super(); this.url = url; this.readyState = 1; this.sent = []; FakeSocket.last = this; }
  send(data) { this.sent.push(JSON.parse(data)); }
  close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
  message(value) { this.dispatchEvent(new MessageEvent('message', { data: typeof value === 'string' ? value : JSON.stringify(value) })); }
}

async function identified(t, overrides = {}) {
  const promise = connect({ ...config, ...overrides }, { WebSocketImpl: FakeSocket });
  const socket = FakeSocket.last;
  socket.message({ op: 0, d: { rpcVersion: 1 } });
  socket.message({ op: 2, d: { negotiatedRpcVersion: 1 } });
  const client = await promise;
  t.after(() => client.close());
  return { client, socket };
}

test('authentication follows OBS double SHA256 challenge protocol', () => {
  const hash = (str) => createHash('sha256').update(str).digest('base64');
  assert.equal(authentication('password', 'salt', 'challenge'), hash(hash('passwordsalt') + 'challenge'));
});

test('Hello generates authenticated Identify and RPC version 1', async (t) => {
  const promise = connect(config, { WebSocketImpl: FakeSocket });
  const socket = FakeSocket.last;
  socket.message({ op: 0, d: { rpcVersion: 9, authentication: { salt: 'salt', challenge: 'challenge' } } });
  assert.deepEqual(socket.sent[0], { op: 1, d: { rpcVersion: 1, eventSubscriptions: 0, authentication: authentication(config.password, 'salt', 'challenge') } });
  socket.message({ op: 2, d: { negotiatedRpcVersion: 1 } });
  const client = await promise;
  t.after(() => client.close());
});

test('concurrent responses are correlated by request id even out of order', async (t) => {
  const { client, socket } = await identified(t);
  const first = client.request('First');
  const second = client.request('Second');
  const ids = socket.sent.slice(1).map((msg) => msg.d.requestId);
  socket.message({ op: 7, d: { requestId: ids[1], requestStatus: { result: true }, responseData: { second: 2 } } });
  socket.message({ op: 7, d: { requestId: ids[0], requestStatus: { result: true }, responseData: { first: 1 } } });
  assert.deepEqual(await first, { first: 1 });
  assert.deepEqual(await second, { second: 2 });
});

test('OBS error response rejects the request without dropping the connection', async (t) => {
  const { client, socket } = await identified(t);
  const promise = client.request('GetInputSettings');
  socket.message({ op: 7, d: { requestType: 'GetInputSettings', requestId: '1', requestStatus: { result: false, code: 600, comment: 'Source not found' } } });
  await assert.rejects(promise, /600.*Source not found/);
  assert.equal(socket.readyState, 1);
});

test('socket closure rejects all in-flight requests', async (t) => {
  const { client, socket } = await identified(t);
  const requests = [client.request('One'), client.request('Two')];
  const results = Promise.allSettled(requests);
  socket.close();
  assert.ok((await results).every((result) => result.status === 'rejected'));
  await assert.rejects(client.request('Three'), /closed/);
});

test('request timeout closes the socket so the watchdog can reconnect', async (t) => {
  const { client, socket } = await identified(t, { requestTimeoutMs: 10 });
  await assert.rejects(client.request('GetVersion'), /timed out/);
  assert.equal(socket.readyState, 3);
});

test('identification timeout releases the connection', async () => {
  const promise = connect({ ...config, connectTimeoutMs: 10 }, { WebSocketImpl: FakeSocket });
  const socket = FakeSocket.last;
  await assert.rejects(promise, /timed out/);
  assert.equal(socket.readyState, 3);
});

test('malformed JSON and missing password fail identification cleanly', async () => {
  for (const message of ['bad JSON', { op: 0, d: { authentication: { salt: 's', challenge: 'c' } } }]) {
    const promise = connect({ ...config, password: '' }, { WebSocketImpl: FakeSocket });
    const socket = FakeSocket.last;
    socket.message(message);
    await assert.rejects(promise);
    assert.equal(socket.readyState, 3);
  }
});

test('abort closes identified sockets and rejects pending requests', async () => {
  const controller = new AbortController();
  const promise = connect(config, { WebSocketImpl: FakeSocket, signal: controller.signal });
  const socket = FakeSocket.last;
  socket.message({ op: 0, d: { rpcVersion: 1 } });
  socket.message({ op: 2, d: { negotiatedRpcVersion: 1 } });
  const client = await promise;
  const request = client.request('Pending');
  controller.abort();
  await assert.rejects(request, /aborted/);
  assert.equal(socket.readyState, 3);
});

test('IPv6 hosts are bracketed in the websocket URL', async (t) => {
  const { socket } = await identified(t, { host: '::1' });
  assert.equal(socket.url, 'ws://[::1]:4455');
});

test('unexpected identification and unsupported RPC versions are rejected', async () => {
  for (const message of [{ op: 2, d: { negotiatedRpcVersion: 1 } }, { op: 0, d: { rpcVersion: 0 } }]) {
    const promise = connect(config, { WebSocketImpl: FakeSocket });
    FakeSocket.last.message(message);
    await assert.rejects(promise, /Unexpected/);
  }
});
