import http from 'node:http';
import type { MidiState } from './state';
import type { ObsPttStatus } from './obs-ptt';

export function createApi(state: MidiState, microphone?: MidiState, obs?: ObsPttStatus): http.Server {
  return http.createServer((req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    const url = new URL(req.url ?? '/', 'http://127.0.0.1');
    if (req.method !== 'GET') {
      res.writeHead(405, { Allow: 'GET' });
      return res.end(JSON.stringify({ error: 'Method not allowed' }));
    }
    if (url.pathname === '/v1/state') {
      if (url.searchParams.get('consumer') === 'warudo') state.lastWarudoRequestAt = new Date().toISOString();
      return res.end(JSON.stringify(state.snapshot()));
    }
    if (url.pathname === '/v1/devices') return res.end(JSON.stringify({ devices: state.devices }));
    if (url.pathname === '/v1/microphone') {
      if (!microphone) {
        return res.end(JSON.stringify({ configured: false, microphoneEnabled: false, obsControlEnabled: false }));
      }
      const { trackingEnabled: microphoneEnabled, ...snapshot } = microphone.snapshot();
      return res.end(JSON.stringify({ ...snapshot, configured: true, microphoneEnabled, obsControlEnabled: obs?.enabled ?? false, obs: obs ?? null }));
    }
    if (url.pathname === '/health') {
      return res.end(JSON.stringify({ ok: true, midiConnected: state.snapshot().connected }));
    }
    res.writeHead(404);
    return res.end(JSON.stringify({ error: 'Not found' }));
  });
}
