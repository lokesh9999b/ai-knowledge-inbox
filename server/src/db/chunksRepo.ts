import { randomUUID } from 'node:crypto';
import type { Db } from './connection.js';

export interface StoredChunk {
  id: string;
  itemId: string;
  position: number;
  text: string;
  title: string;
  sourceUrl: string | null;
  embedding: Float32Array;
}

interface ChunkRow {
  id: string;
  item_id: string;
  position: number;
  text: string;
  embedding: Buffer;
  title: string;
  source_url: string | null;
}

const toVector = (buf: Buffer): Float32Array =>
  new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));

export class ChunksRepo {
  constructor(private readonly db: Db) {}

  /** Replaces all chunks of an item atomically. */
  replaceForItem(itemId: string, embedder: string, chunks: { text: string; embedding: Float32Array }[]): void {
    const insert = this.db.prepare(
      `INSERT INTO chunks (id, item_id, position, text, embedder, embedding) VALUES (?, ?, ?, ?, ?, ?)`,
    );
    this.db.transaction(() => {
      this.db.prepare(`DELETE FROM chunks WHERE item_id = ?`).run(itemId);
      chunks.forEach((c, position) => {
        const blob = Buffer.from(c.embedding.buffer, c.embedding.byteOffset, c.embedding.byteLength);
        insert.run(randomUUID(), itemId, position, c.text, embedder, blob);
      });
    })();
  }

  /**
   * Monotonic counter bumped (by DB triggers) whenever chunks or item statuses change.
   * Callers that cache data derived from `allForEmbedder` compare it to know when to rebuild.
   */
  revision(): number {
    return (this.db.prepare(`SELECT value FROM meta WHERE key = 'vector_revision'`).get() as { value: number }).value;
  }

  /** All chunks of ready items embedded with the given model (the candidate set for search). */
  allForEmbedder(embedder: string): StoredChunk[] {
    const rows = this.db
      .prepare(
        `SELECT c.id, c.item_id, c.position, c.text, c.embedding, i.title, i.source_url
         FROM chunks c JOIN items i ON i.id = c.item_id
         WHERE c.embedder = ? AND i.status = 'ready'`,
      )
      .all(embedder) as ChunkRow[];
    return rows.map((r) => ({
      id: r.id,
      itemId: r.item_id,
      position: r.position,
      text: r.text,
      embedding: toVector(r.embedding),
      title: r.title,
      sourceUrl: r.source_url,
    }));
  }
}
