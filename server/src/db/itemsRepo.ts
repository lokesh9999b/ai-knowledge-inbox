import { randomUUID } from 'node:crypto';
import type { Db } from './connection.js';
import type { Item, ItemStatus, ItemType } from '../types.js';

interface ItemRow {
  id: string;
  type: ItemType;
  title: string;
  source_url: string | null;
  content: string;
  status: ItemStatus;
  error: string | null;
  created_at: string;
  chunk_count: number;
}

const SELECT = `SELECT i.*, (SELECT COUNT(*) FROM chunks c WHERE c.item_id = i.id) AS chunk_count FROM items i`;

const toItem = (r: ItemRow): Item => ({
  id: r.id,
  type: r.type,
  title: r.title,
  sourceUrl: r.source_url,
  content: r.content,
  status: r.status,
  error: r.error,
  chunkCount: r.chunk_count,
  createdAt: r.created_at,
});

export interface NewItem {
  type: ItemType;
  title: string;
  sourceUrl?: string | null;
  content?: string;
  status: ItemStatus;
}

export class ItemsRepo {
  constructor(private readonly db: Db) {}

  create(input: NewItem): Item {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO items (id, type, title, source_url, content, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.type, input.title, input.sourceUrl ?? null, input.content ?? '', input.status, new Date().toISOString());
    return this.get(id)!;
  }

  get(id: string): Item | undefined {
    const row = this.db.prepare(`${SELECT} WHERE i.id = ?`).get(id) as ItemRow | undefined;
    return row && toItem(row);
  }

  list(): Item[] {
    const rows = this.db.prepare(`${SELECT} ORDER BY i.created_at DESC`).all() as ItemRow[];
    return rows.map(toItem);
  }

  setContent(id: string, title: string, content: string): void {
    this.db.prepare(`UPDATE items SET title = ?, content = ? WHERE id = ?`).run(title, content, id);
  }

  setStatus(id: string, status: ItemStatus, error: string | null = null): void {
    this.db.prepare(`UPDATE items SET status = ?, error = ? WHERE id = ?`).run(status, error, id);
  }

  delete(id: string): boolean {
    return this.db.prepare(`DELETE FROM items WHERE id = ?`).run(id).changes > 0;
  }
}
