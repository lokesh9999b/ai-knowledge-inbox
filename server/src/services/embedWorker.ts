// Worker-thread entry point. Runs one embedder off the main thread so model inference never blocks the
// HTTP event loop. Protocol: parent sends { id, texts }, worker replies { id, vectors } or { id, error }.
import { parentPort, workerData } from 'node:worker_threads';
import { HashEmbedder, LocalEmbedder, type Embedder, type EmbedderKind } from './embedder.js';

if (!parentPort) throw new Error('embedWorker must run inside a worker thread');
const port = parentPort;

const { kind, cacheDir } = workerData as { kind: EmbedderKind; cacheDir?: string };
const embedder: Embedder = kind === 'hash' ? new HashEmbedder() : new LocalEmbedder({ info: () => undefined }, cacheDir);
embedder.warmUp?.(); // start loading the model right away

port.on('message', async ({ id, texts }: { id: number; texts: string[] }) => {
  try {
    const vectors = await embedder.embed(texts);
    port.postMessage({ id, vectors }, vectors.map((v) => v.buffer as ArrayBuffer)); // transfer, don't copy
  } catch (err) {
    port.postMessage({ id, error: err instanceof Error ? err.message : String(err) });
  }
});
