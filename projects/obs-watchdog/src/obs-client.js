'use strict';

const { createHash } = require('node:crypto');
const sha256 = (value) => createHash('sha256').update(value).digest('base64');

function authentication(password, salt, challenge) {
  return sha256(sha256(password + salt) + challenge);
}

function connect(config, { WebSocketImpl = globalThis.WebSocket, signal } = {}) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(new Error('Connection aborted')); return; }
    const host = config.host.includes(':') && !config.host.startsWith('[') ? `[${config.host}]` : config.host;
    const ws = new WebSocketImpl(`ws://${host}:${config.port}`);
    const pending = new Map();
    let identified = false;
    let helloReceived = false;
    let closed = false;
    let counter = 0;
    const timer = setTimeout(() => fail(new Error('OBS connection/identification timed out')), config.connectTimeoutMs);
    const abort = () => fail(new Error('Connection aborted'));
    signal?.addEventListener('abort', abort, { once: true });

    function fail(error) {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      if (!identified) reject(error);
      for (const item of pending.values()) {
        clearTimeout(item.timer);
        item.reject(error);
      }
      pending.clear();
      try { ws.close(); } catch { /* Already closed. */ }
    }

    function request(requestType, requestData = {}) {
      return new Promise((res, rej) => {
        if (closed || !identified || ws.readyState !== 1) { rej(new Error('OBS socket is closed')); return; }
        const requestId = String(++counter);
        const requestTimer = setTimeout(() => fail(new Error(`OBS request timed out: ${requestType}`)), config.requestTimeoutMs);
        pending.set(requestId, { resolve: res, reject: rej, timer: requestTimer });
        try { ws.send(JSON.stringify({ op: 6, d: { requestType, requestId, requestData } })); }
        catch (error) { fail(error); }
      });
    }

    ws.addEventListener('message', (event) => {
      if (closed) return;
      try {
        const msg = JSON.parse(event.data);
        if (!msg || !Number.isInteger(msg.op) || !msg.d || typeof msg.d !== 'object') throw new Error('Invalid OBS message');
        if (msg.op === 0) {
          if (helloReceived || !Number.isInteger(msg.d.rpcVersion) || msg.d.rpcVersion < 1) throw new Error('Unexpected or unsupported OBS Hello');
          helloReceived = true;
          const d = { rpcVersion: 1, eventSubscriptions: 0 };
          if (msg.d.authentication) {
            if (!config.password) throw new Error('OBS_WS_PASSWORD is required by this OBS server');
            const { salt, challenge } = msg.d.authentication;
            if (typeof salt !== 'string' || typeof challenge !== 'string') throw new Error('Invalid OBS authentication challenge');
            d.authentication = authentication(config.password, salt, challenge);
          }
          ws.send(JSON.stringify({ op: 1, d }));
        } else if (msg.op === 2) {
          if (!helloReceived || identified || msg.d.negotiatedRpcVersion !== 1) throw new Error('Unexpected OBS Identified');
          identified = true;
          clearTimeout(timer);
          resolve({ ws, request, close: () => fail(new Error('OBS connection closed')) });
        } else if (msg.op === 7) {
          const item = pending.get(msg.d.requestId);
          if (!item) return;
          pending.delete(msg.d.requestId);
          clearTimeout(item.timer);
          if (msg.d.requestStatus?.result !== true) {
            item.reject(new Error(`${msg.d.requestType || 'OBS request'} failed (${msg.d.requestStatus?.code}): ${msg.d.requestStatus?.comment || 'unknown error'}`));
          } else item.resolve(msg.d.responseData || {});
        }
      } catch (error) { fail(error); }
    });
    ws.addEventListener('error', () => fail(new Error('OBS WebSocket connection error')));
    ws.addEventListener('close', (event) => fail(new Error(`OBS connection closed (${event.code || 0})`)));
  });
}

module.exports = { authentication, connect };
