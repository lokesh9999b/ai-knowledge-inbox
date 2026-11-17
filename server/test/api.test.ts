import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, type AppDeps } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { buildDeps } from '../src/container.js';
import { createLogger } from '../src/logger.js';
import { AppError } from '../src/errors.js';
import { HashEmbedder } from '../src/services/embedder.js';
import type { Answerer } from '../src/services/answerer.js';
import type { UrlFetcher } from '../src/services/urlFetcher.js';

const PAGE = 'https://93.184.216.34/guide'; // public IP literal: no DNS needed

function setup(overrides: { answerer?: Answerer; fetcher?: UrlFetcher } = {}) {
  const config = loadConfig({ DB_PATH: ':memory:', EMBEDDER: 'hash', LOG_LEVEL: 'silent' });
  const answerer: Answerer = overrides.answerer ?? {
    answer: vi.fn(async (_q, sources) => ({ answer: `Answer based on ${sources[0]!.title} [1]`, usedFallback: false })),
  };
  const fetcher: UrlFetcher = overrides.fetcher ?? {
    fetchPage: vi.fn(async () => ({
      title: 'Rust Guide',
      text: 'Rust is a systems programming language focused on memory safety without garbage collection.',
    })),
  };
  const deps: AppDeps = buildDeps(config, createLogger('silent'), {
    embedder: new HashEmbedder(),
    answerer,
    fetcher,
    rateLimitPerMinute: 0,
  });
  return { app: createApp(deps), deps, answerer, fetcher };
}

describe('POST /ingest', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => {
    ctx = setup();
  });

  it('accepts a note (202), then indexes it in the background', async () => {
    const res = await request(ctx.app).post('/ingest').send({ type: 'note', content: 'Espresso uses 9 bars of pressure.' });
    expect(res.status).toBe(202);
    expect(res.body.item).toMatchObject({ type: 'note', status: 'processing', title: 'Espresso uses 9 bars of pressure.' });

    await ctx.deps.queue.idle();
    const list = await request(ctx.app).get('/items');
    expect(list.body.items[0]).toMatchObject({ status: 'ready', chunkCount: 1 });
  });

  it('fetches a URL server-side and stores extracted text + metadata', async () => {
    const res = await request(ctx.app).post('/ingest').send({ type: 'url', url: PAGE });
    expect(res.status).toBe(202);
    await ctx.deps.queue.idle();

    const item = (await request(ctx.app).get(`/items/${res.body.item.id}`)).body.item;
    expect(item).toMatchObject({ type: 'url', sourceUrl: PAGE, title: 'Rust Guide', status: 'ready' });
    expect(item.content).toContain('memory safety');
    expect(item.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('marks the item failed (with a reason) when the fetch fails', async () => {
    const failing = setup({
      fetcher: {
        fetchPage: async () => {
          throw new AppError('UPSTREAM_ERROR', 'The URL responded with HTTP 404');
        },
      },
    });
    await request(failing.app).post('/ingest').send({ type: 'url', url: PAGE });
    await failing.deps.queue.idle();
    const [item] = (await request(failing.app).get('/items')).body.items;
    expect(item).toMatchObject({ status: 'failed', error: 'The URL responded with HTTP 404' });
  });

  it.each([
    [{ type: 'note', content: '   ' }, /content/],
    [{ type: 'note' }, /content/],
    [{ type: 'bogus' }, /type/],
    [{ type: 'url', url: 'ftp://example.com/x' }, /http or https/],
    [{ type: 'note', content: 'x'.repeat(20_001) }, /at most 20000/],
  ])('rejects invalid body %j with 400', async (body, message) => {
    const res = await request(ctx.app).post('/ingest').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(message);
  });

  it('rejects private-network URLs with 422 (SSRF guard)', async () => {
    const res = await request(ctx.app).post('/ingest').send({ type: 'url', url: 'http://127.0.0.1:3001/health' });
    expect(res.status).toBe(422);
    expect(res.body.error.message).toMatch(/private/);
    expect(ctx.fetcher.fetchPage).not.toHaveBeenCalled();
  });

  it('returns 400 for malformed JSON', async () => {
    const res = await request(ctx.app).post('/ingest').set('content-type', 'application/json').send('{oops');
    expect(res.status).toBe(400);
    expect(res.body.error.message).toMatch(/JSON/);
  });
});

describe('items endpoints', () => {
  it('lists newest first, 404s unknown ids, and deletes with cascade', async () => {
    const { app, deps } = setup();
    await request(app).post('/ingest').send({ type: 'note', content: 'first note about apples' });
    const second = await request(app).post('/ingest').send({ type: 'note', content: 'second note about oranges' });
    await deps.queue.idle();

    const list = (await request(app).get('/items')).body.items;
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(second.body.item.id);

    expect((await request(app).get('/items/nope')).status).toBe(404);
    expect((await request(app).delete(`/items/${second.body.item.id}`)).status).toBe(204);
    expect((await request(app).delete(`/items/${second.body.item.id}`)).status).toBe(404);
    expect((await request(app).get('/items')).body.items).toHaveLength(1);
  });
});

describe('POST /query', () => {
  it('retrieves the relevant chunk, calls the LLM with it, and returns cited sources', async () => {
    const { app, deps, answerer } = setup();
    await request(app).post('/ingest').send({ type: 'note', title: 'Coffee', content: 'Espresso is brewed by forcing hot water through finely ground coffee at high pressure.' });
    await request(app).post('/ingest').send({ type: 'note', title: 'Gardening', content: 'Tomatoes need six hours of sunlight and regular watering to grow well.' });
    await deps.queue.idle();

    const res = await request(app).post('/query').send({ question: 'How is espresso brewed with hot water?' });
    expect(res.status).toBe(200);
    expect(res.body.sources[0]).toMatchObject({ title: 'Coffee' });
    expect(res.body.sources[0].snippet).toContain('Espresso');
    expect(res.body.sources[0].score).toBeGreaterThan(0);
    expect(res.body.answer).toBe('Answer based on Coffee [1]');
    expect(res.body.usedFallback).toBe(false);
    expect(answerer.answer).toHaveBeenCalledOnce();
  });

  it('skips the LLM and says so when nothing relevant is saved', async () => {
    const { app, answerer } = setup();
    const res = await request(app).post('/query').send({ question: 'What is the capital of France?' });
    expect(res.status).toBe(200);
    expect(res.body.sources).toEqual([]);
    expect(res.body.answer).toMatch(/couldn't find/);
    expect(answerer.answer).not.toHaveBeenCalled();
  });

  it('validates the question and topK', async () => {
    const { app } = setup();
    expect((await request(app).post('/query').send({ question: '' })).status).toBe(400);
    expect((await request(app).post('/query').send({ question: 'valid question', topK: 99 })).status).toBe(400);
  });

  it('maps LLM failures to 502 with a clear message', async () => {
    const { app, deps } = setup({
      answerer: {
        answer: async () => {
          throw new AppError('UPSTREAM_ERROR', 'The language model request failed: 401');
        },
      },
    });
    await request(app).post('/ingest').send({ type: 'note', content: 'Espresso is strong coffee.' });
    await deps.queue.idle();
    const res = await request(app).post('/query').send({ question: 'what is espresso' });
    expect(res.status).toBe(502);
    expect(res.body.error).toMatchObject({ code: 'UPSTREAM_ERROR' });
  });
});

describe('misc', () => {
  it('serves /health and a JSON 404 for unknown routes', async () => {
    const { app } = setup();
    expect((await request(app).get('/health')).body.status).toBe('ok');
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
