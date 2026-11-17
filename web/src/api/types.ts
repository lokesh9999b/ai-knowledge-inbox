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

export interface ItemPage {
  items: ItemSummary[];
  /** Opaque token for the next page; null on the last page. */
  nextCursor: string | null;
  /** Total items matching the filter (not just this page). */
  total: number;
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
  /** True when no language model produced the answer (the extractive last resort). */
  usedFallback: boolean;
  /** Which provider answered (e.g. `groq:openai/gpt-oss-120b`, `extractive`); null when no model was needed. */
  answeredBy: string | null;
  /** Explanation shown when the answer is degraded (backup model, or no model at all). */
  notice?: string;
}

export type IngestInput = { type: 'note'; content: string; title?: string } | { type: 'url'; url: string; title?: string };
