import request from 'supertest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config.js';
import { createLogger } from '../src/logger.js';
import { ChatAnswerer, ExtractiveAnswerer, type Answer, type Answerer } from '../src/services/answerer.js';
import { ChainAnswerer, CircuitBreaker } from '../src/services/answererChain.js';
import { createAnswerer, DEGRADED_NOTICE } from '../src/services/answererFactory.js';
import type { Source } from '../src/types.js';
import { setup } from './helpers.js';
import { startFakeLlm, type FakeLlm } from './fakeLlm.js';

const sources: Source[] = [{ itemId: 'i', chunkId: 'c', title: 'Coffee', sourceUrl: null, snippet: 'Espresso uses 9 bars.', score: 0.9 }];
const ok = (by: string): Answerer => ({ answer: vi.fn(async (): Promise<Answer> => ({ answer: `from ${by} [1]`, usedFallback: false, answeredBy: by })) });
const failing = (): Answerer => ({ answer: vi.fn(async () => { throw new Error('boom'); }) });
const silent = { warn: () => undefined, info: () => undefined };
const last = new ExtractiveAnswerer(DEGRADED_NOTICE);
const breakerOpts = { failureThreshold: 3, cooldownMs: 30_000, deadlineMs: 5_000 };

describe('CircuitBreaker', () => {
  it('opens after the threshold, stays open for the cooldown, then allows a trial', () => {
    let now = 0;
    const b = new CircuitBreaker({ ...breakerOpts, now: () => now });
    b.recordFailure('p');
    b.recordFailure('p');
    expect(b.isOpen('p')).toBe(false);
    b.recordFailure('p');
    expect(b.isOpen('p')).toBe(true);
    now = 29_999;
    expect(b.isOpen('p')).toBe(true);
    now = 30_001;
    expect(b.isOpen('p')).toBe(false); // trial allowed
    b.recordFailure('p'); // failed trial trips it again immediately
    expect(b.isOpen('p')).toBe(true);
  });

  it('a success resets the failure count', () => {
    const b = new CircuitBreaker(breakerOpts);
    b.recordFailure('p');
    b.recordFailure('p');
    b.recordSuccess('p');
    b.recordFailure('p');
    expect(b.isOpen('p')).toBe(false);
  });
});

describe('ChainAnswerer', () => {
  it('uses the primary provider when it works', async () => {
    const chain = new ChainAnswerer([{ name: 'a', answerer: ok('a') }, { name: 'b', answerer: ok('b') }], last, silent, breakerOpts);
    expect(await chain.answer('q', sources)).toMatchObject({ answeredBy: 'a', usedFallback: false, notice: undefined });
  });

  it('falls through to a backup provider and says so', async () => {
    const chain = new ChainAnswerer([{ name: 'a', answerer: failing() }, { name: 'b', answerer: ok('b') }], last, silent, breakerOpts);
    const res = await chain.answer('q', sources);
    expect(res).toMatchObject({ answeredBy: 'b', usedFallback: false });
    expect(res.notice).toMatch(/backup model/);
  });

  it('never throws: when every provider fails it answers extractively with an explanation', async () => {
    const chain = new ChainAnswerer([{ name: 'a', answerer: failing() }, { name: 'b', answerer: failing() }], last, silent, breakerOpts);
    const res = await chain.answer('q', sources);
    expect(res).toMatchObject({ answeredBy: 'extractive', usedFallback: true, notice: DEGRADED_NOTICE });
    expect(res.answer).toContain('Espresso uses 9 bars.');
  });

  it('skips a tripped provider instead of paying its timeout on every request', async () => {
    let now = 0;
    const a = failing();
    const chain = new ChainAnswerer([{ name: 'a', answerer: a }, { name: 'b', answerer: ok('b') }], last, silent, { ...breakerOpts, now: () => now });
    for (let i = 0; i < 3; i++) await chain.answer('q', sources); // 3 failures trip `a`
    expect(a.answer).toHaveBeenCalledTimes(3);
    await chain.answer('q', sources);
    await chain.answer('q', sources);
    expect(a.answer).toHaveBeenCalledTimes(3); // skipped while open
    now = 31_000;
    await chain.answer('q', sources);
    expect(a.answer).toHaveBeenCalledTimes(4); // one trial after the cooldown
  });
});

describe('ChatAnswerer and the real chain against a fake OpenAI-compatible server', () => {
  const servers: FakeLlm[] = [];
  const fake = async (behaviour: Parameters<typeof startFakeLlm>[0]) => {
    const s = await startFakeLlm(behaviour);
    servers.push(s);
    return s;
  };
  afterEach(async () => {
    await Promise.all(servers.splice(0).map((s) => s.close()));
  });
  const logger = { error: () => undefined };
  const chat = (name: string, baseURL: string, timeoutMs = 2000) =>
    new ChatAnswerer({ name, apiKey: 'k', baseURL, model: 'm', timeoutMs }, logger);

  it('returns the completion with normalised citations', async () => {
    const s = await fake({ kind: 'answer', text: 'Nine bars【1】.' });
    expect(await chat('fake', s.baseURL).answer('q', sources)).toMatchObject({ answer: 'Nine bars[1].', answeredBy: 'fake' });
  });

  it('maps a provider 429 with Retry-After to RATE_LIMITED', async () => {
    const s = await fake({ kind: 'status', status: 429, headers: { 'retry-after': '5' } });
    await expect(chat('fake', s.baseURL).answer('q', sources)).rejects.toMatchObject({ code: 'RATE_LIMITED', details: { retryAfterSeconds: 5 } });
  });

  it('treats a hanging provider as failed once the time budget is spent', async () => {
    const s = await fake({ kind: 'hang' });
    const started = Date.now();
    await expect(chat('fake', s.baseURL, 300).answer('q', sources)).rejects.toBeDefined();
    expect(Date.now() - started).toBeLessThan(2500);
  });

  it('fails over from a hanging primary and a rate-limited backup to the extractive answer, quickly', async () => {
    const hang = await fake({ kind: 'hang' });
    const limited = await fake({ kind: 'status', status: 429 });
    const chain = new ChainAnswerer(
      [{ name: 'primary', answerer: chat('primary', hang.baseURL, 300) }, { name: 'backup', answerer: chat('backup', limited.baseURL, 300) }],
      last,
      silent,
      breakerOpts,
    );
    const started = Date.now();
    const res = await chain.answer('q', sources);
    expect(res).toMatchObject({ answeredBy: 'extractive', usedFallback: true });
    expect(Date.now() - started).toBeLessThan(2500);
  });

  it('enforces one overall deadline across providers, even when each has a long per-attempt timeout', async () => {
    const a = await fake({ kind: 'hang' });
    const b = await fake({ kind: 'hang' });
    const chain = new ChainAnswerer(
      [{ name: 'a', answerer: chat('a', a.baseURL, 10_000) }, { name: 'b', answerer: chat('b', b.baseURL, 10_000) }],
      last,
      silent,
      { ...breakerOpts, deadlineMs: 400 },
    );
    const started = Date.now();
    const res = await chain.answer('q', sources);
    expect(res).toMatchObject({ answeredBy: 'extractive', usedFallback: true });
    expect(Date.now() - started).toBeLessThan(1500); // ~400ms deadline, not 2 x 10s
  });

  it('fails over from a hanging primary to a working backup provider', async () => {
    const hang = await fake({ kind: 'hang' });
    const good = await fake({ kind: 'answer', text: 'Backup says 9 bars [1].' });
    const chain = new ChainAnswerer(
      [{ name: 'primary', answerer: chat('primary', hang.baseURL, 300) }, { name: 'backup', answerer: chat('backup', good.baseURL) }],
      last,
      silent,
      breakerOpts,
    );
    expect(await chain.answer('q', sources)).toMatchObject({ answeredBy: 'backup', answer: 'Backup says 9 bars [1].' });
  });
});

describe('createAnswerer (config wiring)', () => {
  const logger = createLogger('silent');

  it('is extractive with a "not configured" notice when no provider is set', async () => {
    const answerer = createAnswerer(loadConfig({ DB_PATH: ':memory:' }), logger);
    expect(await answerer.answer('q', sources)).toMatchObject({ answeredBy: 'extractive', usedFallback: true, notice: expect.stringMatching(/No language model is configured/) });
  });

  it('can run on the optional fallback provider alone (e.g. Hugging Face) without a Groq key', async () => {
    const good = await startFakeLlm({ kind: 'answer', text: 'HF says 9 bars [1].' });
    try {
      const config = loadConfig({
        DB_PATH: ':memory:',
        FALLBACK_LLM_BASE_URL: good.baseURL,
        FALLBACK_LLM_API_KEY: 'hf_test',
        FALLBACK_LLM_MODEL: 'some/model',
      });
      expect(await createAnswerer(config, logger).answer('q', sources)).toMatchObject({ answeredBy: 'fallback:some/model' });
    } finally {
      await good.close();
    }
  });

  it('requires the three FALLBACK_LLM_* settings together', () => {
    expect(() => loadConfig({ DB_PATH: ':memory:', FALLBACK_LLM_MODEL: 'x' })).toThrow(/must be set together/);
    expect(() => loadConfig({ DB_PATH: ':memory:', FALLBACK_LLM_BASE_URL: '', FALLBACK_LLM_API_KEY: '', FALLBACK_LLM_MODEL: '' })).not.toThrow();
  });
});

describe('POST /query with a degraded LLM', () => {
  it('still answers (200) with the extractive passage and a notice instead of erroring', async () => {
    const answerer = new ChainAnswerer([{ name: 'a', answerer: failing() }], last, silent, breakerOpts);
    const { app, deps } = setup({ answerer });
    await request(app).post('/ingest').send({ type: 'note', title: 'Coffee', content: 'Espresso is brewed with hot water under high pressure.' });
    await deps.queue.idle();

    const res = await request(app).post('/query').send({ question: 'how is espresso brewed with hot water' });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ usedFallback: true, answeredBy: 'extractive', notice: DEGRADED_NOTICE });
    expect(res.body.sources[0]).toMatchObject({ title: 'Coffee' });
  });
});
