import { useCallback, useEffect, useState } from 'react';
import { api as defaultApi, type Api } from '../api/client';
import type { IngestInput, ItemSummary } from '../api/types';

const POLL_MS = 1500;

/** Loads items and keeps polling while any item is still being processed on the server. */
export function useItems(api: Api = defaultApi) {
  const [items, setItems] = useState<ItemSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      setItems(await api.listItems());
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

  const hasProcessing = items.some((i) => i.status === 'processing');
  useEffect(() => {
    if (!hasProcessing) return;
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [hasProcessing, refresh]);

  const add = useCallback(
    async (input: IngestInput) => {
      const item = await api.ingest(input); // throws ApiError; the form shows it
      setItems((prev) => [item, ...prev]);
    },
    [api],
  );

  const remove = useCallback(
    async (id: string) => {
      try {
        await api.deleteItem(id);
        setItems((prev) => prev.filter((i) => i.id !== id));
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [api],
  );

  return { items, loading, error, add, remove, refresh };
}
