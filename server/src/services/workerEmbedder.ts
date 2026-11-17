import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import type { Logger } from '../logger.js';
import { EMBEDDER_META, type Embedder, type EmbedderKind } from './embedder.js';

interface Pending {
  resolve: (vectors: Float32Array[]) => void;
  reject: (err: Error) => void;
}

interface Slot {
  worker: Worker;
  pending: Map<number, Pending>;
}

// Run from TypeScript source (tsx / vitest) the worker file is .ts and needs the tsx loader; compiled it is .js.
const IS_TS_SOURCE = import.meta.url.endsWith('.ts');
const WORKER_FILE = fileURLToPath(new URL(`./embedWorker${IS_TS_SOURCE ? '.ts' : '.js'}`, import.meta.url));

/**
 * Embedder that runs inference in a small pool of worker threads, so the HTTP event loop is never blocked by the
 * model and concurrent embeds (queries and indexing) run in parallel. Each request goes to the least busy worker;
 * a crashed worker fails its in-flight requests and is replaced on the next call.
 */
export class WorkerEmbedder implements Embedder {
  readonly id: string;
  readonly minScore: number;
  private readonly slots: (Slot | undefined)[];
  private nextId = 0;
  private closed = false;

  constructor(
    private readonly kind: EmbedderKind,
    size: number,
    private readonly logger: Pick<Logger, 'error' | 'info'>,
    private readonly cacheDir?: string,
  ) {
    if (size < 1) throw new Error('WorkerEmbedder needs at least one worker');
    this.id = EMBEDDER_META[kind].id;
    this.minScore = EMBEDDER_META[kind].minScore;
    this.slots = Array.from({ length: size }, () => undefined);
  }

  warmUp(): void {
    this.slots.forEach((_, i) => this.slot(i));
  }

  embed(texts: string[]): Promise<Float32Array[]> {
    if (this.closed) return Promise.reject(new Error('embedder is closed'));
    // Least-busy worker; spawning lazily keeps unused workers (and their model memory) out of the way.
    let best = 0;
    let bestLoad = Infinity;
    this.slots.forEach((s, i) => {
      const load = s ? s.pending.size : 0;
      if (load < bestLoad) {
        best = i;
        bestLoad = load;
      }
    });
    const slot = this.slot(best);
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      slot.pending.set(id, { resolve, reject });
      slot.worker.postMessage({ id, texts });
    });
  }

  async close(): Promise<void> {
    this.closed = true;
    await Promise.all(
      this.slots.map(async (s, i) => {
        if (!s) return;
        this.slots[i] = undefined;
        this.failPending(s, new Error('embedder is closed'));
        await s.worker.terminate();
      }),
    );
  }

  private slot(index: number): Slot {
    const existing = this.slots[index];
    if (existing) return existing;

    const worker = new Worker(WORKER_FILE, {
      workerData: { kind: this.kind, cacheDir: this.cacheDir },
      execArgv: IS_TS_SOURCE ? ['--import', 'tsx'] : undefined,
    });
    const slot: Slot = { worker, pending: new Map() };
    this.slots[index] = slot;

    worker.on('message', (msg: { id: number; vectors?: Float32Array[]; error?: string }) => {
      const p = slot.pending.get(msg.id);
      if (!p) return;
      slot.pending.delete(msg.id);
      if (msg.error !== undefined) p.reject(new Error(msg.error));
      else p.resolve(msg.vectors ?? []);
    });
    const onDead = (err: Error) => {
      if (this.slots[index] === slot) this.slots[index] = undefined; // respawned on next use
      if (!this.closed) this.logger.error({ err }, 'embedding worker stopped');
      this.failPending(slot, err);
    };
    worker.on('error', onDead);
    worker.on('exit', (code) => {
      if (slot.pending.size > 0 || this.slots[index] === slot) onDead(new Error(`embedding worker exited (code ${code})`));
    });
    return slot;
  }

  private failPending(slot: Slot, err: Error): void {
    for (const p of slot.pending.values()) p.reject(err);
    slot.pending.clear();
  }
}
