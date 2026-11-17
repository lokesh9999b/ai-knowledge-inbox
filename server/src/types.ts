export type ItemType = 'note' | 'url';
export type ItemStatus = 'processing' | 'ready' | 'failed';

export interface Item {
  id: string;
  type: ItemType;
  title: string;
  sourceUrl: string | null;
  content: string; // raw content (note text, or text extracted from the URL)
  status: ItemStatus;
  error: string | null;
  chunkCount: number;
  createdAt: string; // ISO timestamp
}

/** What the API returns for an item (raw content is shortened to a preview). */
export interface ItemSummary extends Omit<Item, 'content'> {
  preview: string;
}

export interface Source {
  itemId: string;
  chunkId: string;
  title: string;
  sourceUrl: string | null;
  snippet: string;
  score: number;
}
