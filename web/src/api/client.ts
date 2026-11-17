import type { IngestInput, ItemPage, ItemStatus, ItemSummary, QueryResult } from './types';

export interface ListParams {
  cursor?: string;
  status?: ItemStatus;
  limit?: number;
}

const BASE = import.meta.env.VITE_API_URL ?? '/api';

/** Error carrying the server's { error: { code, message } } payload. */
export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
    });
  } catch {
    throw new ApiError('Cannot reach the server. Is it running?', 0, 'NETWORK_ERROR');
  }
  if (res.status === 204) return undefined as T;
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    throw new ApiError(body?.error?.message ?? `Request failed (HTTP ${res.status})`, res.status, body?.error?.code ?? 'UNKNOWN');
  }
  return body as T;
}

export const api = {
  listItems: ({ cursor, status, limit }: ListParams = {}) => {
    const params = new URLSearchParams();
    if (cursor) params.set('cursor', cursor);
    if (status) params.set('status', status);
    if (limit) params.set('limit', String(limit));
    const qs = params.toString();
    return request<ItemPage>(`/items${qs ? `?${qs}` : ''}`);
  },
  getItem: (id: string) => request<{ item: ItemSummary }>(`/items/${id}`).then((r) => r.item),
  ingest: (input: IngestInput) =>
    request<{ item: ItemSummary }>('/ingest', { method: 'POST', body: JSON.stringify(input) }).then((r) => r.item),
  deleteItem: (id: string) => request<void>(`/items/${id}`, { method: 'DELETE' }),
  query: (question: string) => request<QueryResult>('/query', { method: 'POST', body: JSON.stringify({ question }) }),
};

export type Api = typeof api;
