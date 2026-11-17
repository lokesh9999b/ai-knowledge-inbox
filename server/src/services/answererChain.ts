import type { Logger } from '../logger.js';
import type { Source } from '../types.js';
import type { Answer, Answerer } from './answerer.js';

export interface NamedAnswerer {
  name: string;
  answerer: Answerer;
}

export interface ChainOptions extends BreakerOptions {
  /** Hard cap on the whole chain: once spent, in-flight attempts are aborted and the extractive answer is used. */
  deadlineMs: number;
}

export interface BreakerOptions {
  /** Consecutive failures before a provider is skipped. */
  failureThreshold: number;
  /** How long a tripped provider is skipped before it gets another try. */
  cooldownMs: number;
  now?: () => number;
}

/**
 * Per-provider circuit breaker. Without it, a provider that is down would cost every request its full timeout
 * before the next provider is tried. After `failureThreshold` consecutive failures the provider is skipped for
 * `cooldownMs`; the first call after that is a trial, and one more failure trips it again immediately.
 */
export class CircuitBreaker {
  private readonly state = new Map<string, { failures: number; openUntil: number }>();
  private readonly now: () => number;

  constructor(private readonly options: BreakerOptions) {
    this.now = options.now ?? Date.now;
  }

  isOpen(name: string): boolean {
    return (this.state.get(name)?.openUntil ?? 0) > this.now();
  }

  recordSuccess(name: string): void {
    this.state.delete(name);
  }

  recordFailure(name: string): void {
    const current = this.state.get(name) ?? { failures: 0, openUntil: 0 };
    current.failures++;
    if (current.failures >= this.options.failureThreshold) current.openUntil = this.now() + this.options.cooldownMs;
    this.state.set(name, current);
  }
}

const BACKUP_NOTICE = 'The main language model was unavailable, so a backup model wrote this answer.';

/**
 * Tries each provider in order and falls through on any failure (timeout, 429, 5xx, bad key, empty answer).
 * If every provider fails or is tripped, `lastResort` (extractive) answers, so a question never errors just because
 * the LLM side is slow or down. The result says which provider answered and, when degraded, why.
 */
export class ChainAnswerer implements Answerer {
  private readonly breaker: CircuitBreaker;

  constructor(
    private readonly providers: NamedAnswerer[],
    private readonly lastResort: Answerer,
    private readonly logger: Pick<Logger, 'warn' | 'info'>,
    private readonly options: ChainOptions,
  ) {
    this.breaker = new CircuitBreaker(options);
  }

  async answer(question: string, sources: Source[]): Promise<Answer> {
    const skipped: string[] = [];
    const signal = AbortSignal.timeout(this.options.deadlineMs); // one budget shared by every provider
    for (const [index, provider] of this.providers.entries()) {
      if (signal.aborted) break;
      if (this.breaker.isOpen(provider.name)) {
        skipped.push(provider.name);
        continue;
      }
      try {
        const answer = await provider.answerer.answer(question, sources, { signal });
        this.breaker.recordSuccess(provider.name);
        if (index > 0) this.logger.info({ provider: provider.name }, 'answered by a backup provider');
        return { ...answer, answeredBy: provider.name, notice: index > 0 ? BACKUP_NOTICE : undefined };
      } catch (err) {
        this.breaker.recordFailure(provider.name);
        this.logger.warn({ provider: provider.name, err }, 'LLM provider failed, trying the next one');
      }
    }
    this.logger.warn({ skipped }, 'no LLM provider available, using extractive answer');
    return this.lastResort.answer(question, sources);
  }
}
