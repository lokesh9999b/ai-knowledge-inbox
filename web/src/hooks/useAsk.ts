import { useCallback, useState } from 'react';
import { api as defaultApi, type Api } from '../api/client';
import type { QueryResult } from '../api/types';

export function useAsk(api: Api = defaultApi) {
  const [result, setResult] = useState<QueryResult | null>(null);
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = useCallback(
    async (question: string) => {
      setAsking(true);
      setError(null);
      try {
        setResult(await api.query(question));
      } catch (e) {
        setResult(null);
        setError((e as Error).message);
      } finally {
        setAsking(false);
      }
    },
    [api],
  );

  return { result, asking, error, ask };
}
