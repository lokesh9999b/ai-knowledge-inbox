import type { ChunksRepo, StoredChunk } from '../db/chunksRepo.js';
import type { Embedder } from './embedder.js';
import type { Source } from '../types.js';

const SNIPPET_CHARS = 400;

type ChunkMeta = Omit<StoredChunk, 'embedding'>;

/** All candidate vectors packed into one contiguous matrix (row i belongs to `chunks[i]`). */
interface Snapshot {
  revision: number;
  dim: number;
  chunks: ChunkMeta[];
  matrix: Float32Array;
}

/**
 * Top-k cosine search over chunks stored in SQLite.
 *
 * The decoded vectors are cached in memory as one contiguous matrix and rebuilt only when the database
 * revision changes (see `ChunksRepo.revision`), so a query costs one embed call plus a dot-product scan with
 * no SQLite reads or BLOB decoding. The scan is still O(n); see docs/architecture/system-design.md.
 */
export class VectorSearch {
  private snapshot?: Snapshot;

  constructor(
    private readonly chunks: ChunksRepo,
    private readonly embedder: Embedder,
  ) {}

  async search(question: string, topK: number): Promise<Source[]> {
    const [queryVector] = await this.embedder.embed([question]);
    if (!queryVector) return [];

    // Synchronous from here on, so the snapshot cannot change between the revision check and the scan.
    // Vectors are L2-normalised, so cosine similarity is just the dot product.
    const { chunks, matrix, dim } = this.current();
    const scored: { index: number; score: number }[] = [];
    for (let i = 0; i < chunks.length; i++) {
      let dot = 0;
      const offset = i * dim;
      for (let d = 0; d < dim; d++) dot += queryVector[d]! * matrix[offset + d]!;
      if (dot >= this.embedder.minScore) scored.push({ index: i, score: dot });
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, topK)
      .map(({ index, score }) => {
        const chunk = chunks[index]!;
        return {
          itemId: chunk.itemId,
          chunkId: chunk.id,
          title: chunk.title,
          sourceUrl: chunk.sourceUrl,
          snippet: chunk.text.length > SNIPPET_CHARS ? `${chunk.text.slice(0, SNIPPET_CHARS)}…` : chunk.text,
          score: Math.round(score * 1000) / 1000,
        };
      });
  }

  private current(): Snapshot {
    const revision = this.chunks.revision();
    if (this.snapshot?.revision === revision) return this.snapshot;

    const rows = this.chunks.allForEmbedder(this.embedder.id);
    const dim = rows[0]?.embedding.length ?? 0;
    const matrix = new Float32Array(rows.length * dim);
    const chunks: ChunkMeta[] = rows.map(({ embedding, ...meta }, i) => {
      matrix.set(embedding, i * dim);
      return meta;
    });
    this.snapshot = { revision, dim, chunks, matrix };
    return this.snapshot;
  }
}
