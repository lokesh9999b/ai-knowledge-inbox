import type { Logger } from '../logger.js';
import { HashEmbedder, LocalEmbedder, type Embedder, type EmbedderKind } from './embedder.js';
import { WorkerEmbedder } from './workerEmbedder.js';

/**
 * - `local` + workers > 0: MiniLM in a worker-thread pool (default; keeps the event loop free).
 * - `local` + workers = 0: MiniLM on the main thread.
 * - `hash`: tiny and fast, always in-process.
 * `cacheDir` is where the local model's files live (baked into the Docker image).
 */
export function createEmbedder(kind: EmbedderKind, workers: number, logger: Logger, cacheDir?: string): Embedder {
  if (kind === 'hash') return new HashEmbedder();
  return workers > 0 ? new WorkerEmbedder('local', workers, logger, cacheDir) : new LocalEmbedder(logger, cacheDir);
}
