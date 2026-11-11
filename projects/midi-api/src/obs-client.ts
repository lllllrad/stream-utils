import { createHash } from 'node:crypto';
import type { ObsConfig } from './types';

export interface ObsSocket {
  readonly readyState: number;
  send(data: string): void;
  close(): void;
  addEventListener(type: 'message', listener: (event: { data: unknown }) => void): void;
  addEventListener(type: 'error', listener: () => void): void;
  addEventListener(type: 'close', listener: (event: { code?: number }) => void): void;
}

export interface ObsConnection {
  readonly isOpen: boolean;
  request(type: string, data?: Record<string, unknown>): Promise<Record<string, unknown>>;
  close(): void;
}

interface Response {
  op: number;
  d: {
    rpcVersion?: number;
    negotiatedRpcVersion?: number;
    authentication?: { salt: string; challenge: string };
    requestId?: string;
    requestType?: string;
    requestStatus?: { result: boolean; code?: number; comment?: string };
    responseData?: Record<string, unknown>;
  };
}

export function authentication(password: string, salt: string, challenge: string): string {
  const hash = (text: string) => createHash('sha256').update(text).digest('base64');
  return hash(hash(password + salt) + challenge);
}

export function connectObs(config: ObsConfig, password: string, {
  createSocket = (url: string): ObsSocket => new WebSocket(url),
} = {}): Promise<ObsConnection> {
  return new Promise((resolve, reject) => {
    const host = config.host.includes(':') && !config.host.startsWith('[') ? `[${config.host}]` : config.host;
    const socket = createSocket(`ws://${host}:${config.port}`);
    let hello = false;
    let identified = false;
    let closed = false;
    let counter = 0;
    const pending = new Map<string, {
      resolve(value: Record<string, unknown>): void;
      reject(error: Error): void;
      timer: NodeJS.Timeout;
    }>();
    const timer = setTimeout(() => fail(new Error('OBS connection timed out')), config.connectTimeoutMs);

    function fail(error: Error): void {
      if (closed) return;
      closed = true;
      clearTimeout(timer);
      if (!identified) reject(error);
      for (const item of pending.values()) { clearTimeout(item.timer); item.reject(error); }
      pending.clear();
      try { socket.close(); } catch { /* Already closed. */ }
    }

    function request(type: string, data: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
      return new Promise((done, failed) => {
        if (closed || !identified || socket.readyState !== 1) { failed(new Error('OBS connection is closed')); return; }
        const requestId = String(++counter);
        const requestTimer = setTimeout(() => fail(new Error(`OBS request timed out: ${type}`)), config.requestTimeoutMs);
        pending.set(requestId, { resolve: done, reject: failed, timer: requestTimer });
        try { socket.send(JSON.stringify({ op: 6, d: { requestType: type, requestId, requestData: data } })); }
        catch { fail(new Error('OBS send failed')); }
      });
    }

    socket.addEventListener('message', (event) => {
      if (closed) return;
      try {
        const message = JSON.parse(String(event.data)) as Response;
        if (!message || !Number.isInteger(message.op) || !message.d || typeof message.d !== 'object') throw new Error('Invalid OBS message');
        if (message.op === 0) {
          if (hello || !Number.isInteger(message.d.rpcVersion) || message.d.rpcVersion! < 1) throw new Error('Unsupported OBS Hello');
          hello = true;
          const identify: { rpcVersion: number; eventSubscriptions: number; authentication?: string } = { rpcVersion: 1, eventSubscriptions: 0 };
          if (message.d.authentication) {
            if (!password) throw new Error('OBS_WS_PASSWORD is required');
            const { salt, challenge } = message.d.authentication;
            if (typeof salt !== 'string' || typeof challenge !== 'string') throw new Error('Invalid OBS challenge');
            identify.authentication = authentication(password, salt, challenge);
          }
          socket.send(JSON.stringify({ op: 1, d: identify }));
        } else if (message.op === 2) {
          if (!hello || identified || message.d.negotiatedRpcVersion !== 1) throw new Error('Unexpected OBS Identified');
          identified = true;
          clearTimeout(timer);
          resolve({ get isOpen() { return !closed && socket.readyState === 1; }, request, close: () => fail(new Error('OBS connection closed')) });
        } else if (message.op === 7 && message.d.requestId) {
          const item = pending.get(message.d.requestId);
          if (!item) return;
          pending.delete(message.d.requestId);
          clearTimeout(item.timer);
          if (message.d.requestStatus?.result !== true) item.reject(new Error(`OBS request rejected: ${message.d.requestType ?? 'unknown'} (${message.d.requestStatus?.code ?? 0})`));
          else item.resolve(message.d.responseData ?? {});
        }
      } catch (error) { fail(error instanceof Error ? error : new Error('Invalid OBS response')); }
    });
    socket.addEventListener('error', () => fail(new Error('OBS WebSocket connection error')));
    socket.addEventListener('close', () => fail(new Error('OBS WebSocket closed')));
  });
}
