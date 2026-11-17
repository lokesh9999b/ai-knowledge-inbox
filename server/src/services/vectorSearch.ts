import type { ChunksRepo } from '../db/chunksRepo.js';
import type { Embedder } from './embedder.js';
import type { Source } from '../types.js';

/** Vectors are L2-normalised, so cosine similarity is just the dot product. */
export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i]! * b[i]!;
  return dot;
}

const SNIPPET_CHARS = 400;

/**
 * Brute-force top-k cosine search over chunks stored in SQLite. O(n) per query, which is fine for
 * a single user's inbox (thousands of chunks); see docs/DESIGN.md for what changes at scale.
 */
export class VectorSearch {
  constructor(
    private readonly chunks: ChunksRepo,
    private readonly embedder: Embedder,
  ) {}

  async search(question: string, topK: number): Promise<Source[]> {
    const [queryVector] = await this.embedder.embed([question]);
    if (!queryVector) return [];
    return this.chunks
      .allForEmbedder(this.embedder.id)
      .map((c) => ({ chunk: c, score: cosine(queryVector, c.embedding) }))
      .filter((r) => r.score >= this.embedder.minScore)
      .sort((x, y) => y.score - x.score)
      .slice(0, topK)
      .map(({ chunk, score }) => ({
        itemId: chunk.itemId,
        chunkId: chunk.id,
        title: chunk.title,
        sourceUrl: chunk.sourceUrl,
        snippet: chunk.text.length > SNIPPET_CHARS ? `${chunk.text.slice(0, SNIPPET_CHARS)}…` : chunk.text,
        score: Math.round(score * 1000) / 1000,
      }));
  }
}
