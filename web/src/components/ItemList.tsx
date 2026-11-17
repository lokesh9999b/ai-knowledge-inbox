import type { ItemSummary } from '../api/types';

const STATUS_STYLE: Record<ItemSummary['status'], string> = {
  processing: 'bg-amber-100 text-amber-800',
  ready: 'bg-green-100 text-green-800',
  failed: 'bg-red-100 text-red-800',
};

interface Props {
  items: ItemSummary[];
  /** Total saved items, which can be more than the number currently loaded. */
  total: number;
  loading: boolean;
  hasMore: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onDelete: (id: string) => void;
}

export function ItemList({ items, total, loading, hasMore, loadingMore, onLoadMore, onDelete }: Props) {
  return (
    <section aria-labelledby="items-heading" className="space-y-2">
      <h2 id="items-heading" className="font-semibold">
        Saved items ({total})
      </h2>
      {loading && <p className="text-sm text-slate-500">Loading…</p>}
      {!loading && items.length === 0 && <p className="text-sm text-slate-500">Nothing saved yet. Add a note or URL above.</p>}
      <ul className="space-y-2">
        {items.map((item) => (
          <li key={item.id} className="rounded-lg border border-slate-200 bg-white p-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="truncate font-medium">
                  <span className="mr-2 text-xs uppercase text-slate-400">{item.type}</span>
                  {item.sourceUrl ? (
                    <a href={item.sourceUrl} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                      {item.title}
                    </a>
                  ) : (
                    item.title
                  )}
                </p>
                <p className="text-xs text-slate-500">{new Date(item.createdAt).toLocaleString()}</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-xs ${STATUS_STYLE[item.status]}`}>{item.status}</span>
                <button
                  onClick={() => onDelete(item.id)}
                  aria-label={`Delete ${item.title}`}
                  className="text-xs text-slate-400 hover:text-red-600"
                >
                  Delete
                </button>
              </div>
            </div>
            {item.preview && <p className="mt-1 line-clamp-2 text-sm text-slate-600">{item.preview}</p>}
            {item.status === 'failed' && item.error && <p className="mt-1 text-sm text-red-700">{item.error}</p>}
          </li>
        ))}
      </ul>
      {hasMore && (
        <button
          onClick={onLoadMore}
          disabled={loadingMore}
          className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm hover:bg-slate-50 disabled:opacity-50"
        >
          {loadingMore ? 'Loading…' : `Load more (${total - items.length} remaining)`}
        </button>
      )}
    </section>
  );
}
