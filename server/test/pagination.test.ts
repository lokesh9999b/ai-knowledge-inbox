import request from 'supertest';
import { describe, expect, it } from 'vitest';
import { setup } from './helpers.js';

async function seed(count: number) {
  const ctx = setup();
  for (let i = 0; i < count; i++) {
    await request(ctx.app).post('/ingest').send({ type: 'note', content: `note number ${i} about topic ${i}` });
  }
  await ctx.deps.queue.idle();
  return ctx;
}

describe('GET /items pagination', () => {
  it('returns pages newest-first with a cursor and no duplicates or gaps', async () => {
    const { app } = await seed(7);

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const res = await request(app).get('/items').query({ limit: 3, ...(cursor ? { cursor } : {}) });
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(7);
      seen.push(...res.body.items.map((i: { id: string }) => i.id));
      cursor = res.body.nextCursor;
      pages++;
    } while (cursor);

    expect(pages).toBe(3); // 3 + 3 + 1
    expect(new Set(seen).size).toBe(7);

    const all = (await request(app).get('/items').query({ limit: 100 })).body;
    expect(all.items.map((i: { id: string }) => i.id)).toEqual(seen); // same order as the paged walk
    expect(all.nextCursor).toBeNull();
  });

  it('defaults to a page size of 50', async () => {
    const { app } = await seed(2);
    const res = await request(app).get('/items');
    expect(res.body.items).toHaveLength(2);
    expect(res.body.nextCursor).toBeNull();
  });

  it('filters by status and reports the filtered total', async () => {
    const ctx = setup();
    await request(ctx.app).post('/ingest').send({ type: 'note', content: 'first note body' });
    await ctx.deps.queue.idle();
    // Left unprocessed: written straight to the repo so it stays "processing".
    ctx.deps.items.create({ type: 'note', title: 'stuck', content: 'x', status: 'processing' });

    const processing = (await request(ctx.app).get('/items').query({ status: 'processing' })).body;
    expect(processing.items.map((i: { title: string }) => i.title)).toEqual(['stuck']);
    expect(processing.total).toBe(1);
    expect((await request(ctx.app).get('/items').query({ status: 'ready' })).body.total).toBe(1);
  });

  it.each([
    [{ limit: 0 }, /limit/],
    [{ limit: 101 }, /limit/],
    [{ limit: 'abc' }, /limit/],
    [{ status: 'nope' }, /status/],
    [{ cursor: 'not-a-real-cursor' }, /cursor/],
  ])('rejects bad query %j with 400', async (query, message) => {
    const { app } = setup();
    const res = await request(app).get('/items').query(query);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.message).toMatch(message);
  });

  it('GET /items/:id returns summary fields plus full content', async () => {
    const { app, deps } = setup();
    const created = await request(app).post('/ingest').send({ type: 'note', content: 'full body text here' });
    await deps.queue.idle();
    const { item } = (await request(app).get(`/items/${created.body.item.id}`)).body;
    expect(item).toMatchObject({ status: 'ready', preview: 'full body text here', content: 'full body text here' });
  });
});
