import type { Logger } from '../logger.js';

type Job = () => Promise<void>;

/**
 * Minimal in-process FIFO queue that runs one job at a time (embedding is CPU-bound, and serial
 * execution keeps memory predictable). Jobs are lost on restart; see docs/DESIGN.md.
 */
export class JobQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(private readonly logger: Logger) {}

  enqueue(name: string, job: Job): void {
    this.pending++;
    this.tail = this.tail
      .then(job)
      .catch((err) => this.logger.error({ err, job: name }, 'background job failed'))
      .finally(() => {
        this.pending--;
      });
  }

  /** Resolves when every job enqueued so far has finished (used by tests and graceful shutdown). */
  async idle(): Promise<void> {
    await this.tail;
  }

  get size(): number {
    return this.pending;
  }
}
