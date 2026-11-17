import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { setup } from './helpers.js';

const ask = (app: ReturnType<typeof setup>['app'], question: string) =>
  request(app).post('/query').send({ question }).then((r) => r.body);

describe('vector cache', () => {
  it('reads vectors from SQLite once, then serves repeat queries from memory', async () => {
    const { app, deps } = setup();
    const spy = vi.spyOn(deps.chunks, 'allForEmbedder');
    await request(app).post('/ingest').send({ type: 'note', title: 'Coffee', content: 'Espresso is brewed with hot water under high pressure.' });
    await deps.queue.idle();

    for (let i = 0; i < 5; i++) await ask(app, 'how is espresso brewed with hot water');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('sees newly indexed items immediately (cache invalidated by revision)', async () => {
    const { app, deps } = setup();
    await request(app).post('/ingest').send({ type: 'note', title: 'Coffee', content: 'Espresso is brewed with hot water under high pressure.' });
    await deps.queue.idle();
    expect((await ask(app, 'tomatoes sunlight')).sources).toEqual([]); // no lexical overlap; primes the cache

    await request(app).post('/ingest').send({ type: 'note', title: 'Garden', content: 'Tomatoes grow best with plenty of sunlight and water.' });
    await deps.queue.idle();
    const after = await ask(app, 'tomatoes sunlight');
    expect(after.sources[0]).toMatchObject({ title: 'Garden' });
  });

  it('stops returning deleted items (cascade delete bumps the revision)', async () => {
    const { app, deps } = setup();
    const created = await request(app).post('/ingest').send({ type: 'note', title: 'Coffee', content: 'Espresso is brewed with hot water under high pressure.' });
    await deps.queue.idle();
    expect((await ask(app, 'espresso hot water pressure')).sources).toHaveLength(1); // primes the cache

    await request(app).delete(`/items/${created.body.item.id}`);
    expect((await ask(app, 'espresso hot water pressure')).sources).toEqual([]);
  });

  it('bumps the revision on chunk writes, status changes and cascades', async () => {
    const { deps } = setup();
    const r0 = deps.chunks.revision();
    const item = deps.items.create({ type: 'note', title: 't', content: 'c', status: 'processing' });
    deps.chunks.replaceForItem(item.id, 'hash-v1-384', [{ text: 'c', embedding: new Float32Array(384) }]);
    const r1 = deps.chunks.revision();
    expect(r1).toBeGreaterThan(r0);
    deps.items.setStatus(item.id, 'ready');
    const r2 = deps.chunks.revision();
    expect(r2).toBeGreaterThan(r1);
    deps.items.delete(item.id);
    expect(deps.chunks.revision()).toBeGreaterThan(r2);
  });
});
