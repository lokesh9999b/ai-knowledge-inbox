import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

export type FakeLlmBehaviour =
  | { kind: 'answer'; text: string }
  | { kind: 'status'; status: number; headers?: Record<string, string> }
  | { kind: 'hang' };

export interface FakeLlm {
  baseURL: string;
  close(): Promise<void>;
}

/** A minimal OpenAI-compatible /v1/chat/completions endpoint with a scripted behaviour, on a random local port. */
export async function startFakeLlm(behaviour: FakeLlmBehaviour): Promise<FakeLlm> {
  const sockets = new Set<import('node:net').Socket>();
  const server: Server = createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      if (behaviour.kind === 'hang') return; // never respond: simulates a provider that is too slow
      if (behaviour.kind === 'status') {
        res.writeHead(behaviour.status, { 'content-type': 'application/json', ...behaviour.headers });
        res.end(JSON.stringify({ error: { message: `scripted ${behaviour.status}` } }));
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ id: 'x', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: behaviour.text }, finish_reason: 'stop' }] }));
    });
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return {
    baseURL: `http://127.0.0.1:${port}/v1`,
    close: () =>
      new Promise<void>((resolve) => {
        sockets.forEach((s) => s.destroy()); // hung connections would otherwise keep close() waiting
        server.close(() => resolve());
      }),
  };
}
