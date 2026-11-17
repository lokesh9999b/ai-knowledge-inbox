export type ItemType = 'note' | 'url';
export type ItemStatus = 'processing' | 'ready' | 'failed';

export interface ItemSummary {
  id: string;
  type: ItemType;
  title: string;
  sourceUrl: string | null;
  status: ItemStatus;
  error: string | null;
  chunkCount: number;
  createdAt: string;
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

export interface QueryResult {
  answer: string;
  sources: Source[];
  usedFallback: boolean;
}

export type IngestInput = { type: 'note'; content: string; title?: string } | { type: 'url'; url: string; title?: string };
