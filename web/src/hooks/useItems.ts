import { useCallback, useEffect, useRef, useState } from 'react';
import { api as defaultApi, type Api } from '../api/client';
import type { IngestInput, ItemSummary } from '../api/types';

const POLL_MS = 1500;

/**
 * Loads items one page at a time ("Load more") and, while any loaded item is still processing, polls the cheap
 * `status=processing` listing. Only items that dropped out of that listing are re-fetched individually, so polling
 * cost does not grow with the size of the inbox.
 */
export function useItems(api: Api = defaultApi) {
  const [items, setItems] = useState<ItemSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const itemsRef = useRef(items);
  itemsRef.current = items;

  const refresh = useCallback(async () => {
    try {
      const page = await api.listItems();
      setItems(page.items);
      setNextCursor(page.nextCursor);
      setTotal(page.total);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await api.listItems({ cursor: nextCursor });
      setItems((prev) => {
        const seen = new Set(prev.map((i) => i.id));
        return [...prev, ...page.items.filter((i) => !seen.has(i.id))];
      });
      setNextCursor(page.nextCursor);
      setTotal(page.total);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoadingMore(false);
    }
  }, [api, nextCursor]);

  const hasProcessing = items.some((i) => i.status === 'processing');
  useEffect(() => {
    if (!hasProcessing) return;
    const timer = setInterval(async () => {
      try {
        const stillProcessing = new Set((await api.listItems({ status: 'processing', limit: 100 })).items.map((i) => i.id));
        const finished = itemsRef.current.filter((i) => i.status === 'processing' && !stillProcessing.has(i.id));
        if (finished.length === 0) return;
        const updated = await Promise.all(finished.map((i) => api.getItem(i.id).catch(() => null)));
        setItems((prev) => prev.map((i) => updated.find((u) => u?.id === i.id) ?? i));
      } catch (e) {
        setError((e as Error).message);
      }
    }, POLL_MS);
    return () => clearInterval(timer);
  }, [hasProcessing, api]);

  const add = useCallback(
    async (input: IngestInput) => {
      const item = await api.ingest(input); // throws ApiError; the form shows it
      setItems((prev) => [item, ...prev]);
      setTotal((t) => t + 1);
    },
    [api],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await api.deleteItem(id);
        setItems((prev) => prev.filter((i) => i.id !== id));
        setTotal((t) => Math.max(0, t - 1));
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [api],
  );

  return { items, total, hasMore: nextCursor !== null, loading, loadingMore, error, add, remove, loadMore, refresh };
}
