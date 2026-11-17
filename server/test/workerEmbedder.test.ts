import { afterEach, describe, expect, it } from 'vitest';
import { HashEmbedder } from '../src/services/embedder.js';
import { WorkerEmbedder } from '../src/services/workerEmbedder.js';

const silent = { info: () => undefined, error: () => undefined };
const open: WorkerEmbedder[] = [];
const create = (size: number) => {
  const e = new WorkerEmbedder('hash', size, silent);
  open.push(e);
  return e;
};

afterEach(async () => {
  await Promise.all(open.splice(0).map((e) => e.close()));
});

describe('WorkerEmbedder', () => {
  it('produces exactly the same vectors as the in-process embedder', async () => {
    const texts = ['espresso pressure and brewing', 'tomatoes need sunlight', ''];
    const inProcess = await new HashEmbedder().embed(texts);
    const viaWorker = await create(1).embed(texts);
    expect(viaWorker).toHaveLength(3);
    viaWorker.forEach((v, i) => expect(Array.from(v)).toEqual(Array.from(inProcess[i]!)));
  });

  it('exposes the same id and minScore as the embedder it wraps', () => {
    const e = create(1);
    const reference = new HashEmbedder();
    expect(e.id).toBe(reference.id);
    expect(e.minScore).toBe(reference.minScore);
  });

  it('answers many concurrent requests correctly across a pool', async () => {
    const e = create(2);
    const texts = Array.from({ length: 40 }, (_, i) => `request number ${i} about topic ${i * 3}`);
    const results = await Promise.all(texts.map((t) => e.embed([t])));
    const expected = await new HashEmbedder().embed(texts);
    results.forEach((r, i) => expect(Array.from(r[0]!)).toEqual(Array.from(expected[i]!)));
  });

  it('replaces a crashed worker and fails only its in-flight requests', async () => {
    const e = create(1);
    await e.embed(['spawn the worker']);
    const slot = (Reflect.get(e, 'slots') as { worker: { terminate(): Promise<number> } }[])[0]!;
    await slot.worker.terminate(); // simulate a crash
    // The next call may hit the dying worker or its replacement; once it settles, a fresh call must succeed.
    await e.embed(['during crash']).catch(() => undefined);
    const [v] = await e.embed(['after crash']);
    expect(v).toHaveLength(384);
  });

  it('rejects work after close()', async () => {
    const e = create(1);
    await e.embed(['hello']);
    await e.close();
    await expect(e.embed(['too late'])).rejects.toThrow(/closed/);
  });

  it('rejects an invalid pool size', () => {
    expect(() => new WorkerEmbedder('hash', 0, silent)).toThrow(/at least one/);
  });
});
