import { AddItemForm } from './components/AddItemForm';
import { AskPanel } from './components/AskPanel';
import { ErrorBanner } from './components/ErrorBanner';
import { ItemList } from './components/ItemList';
import { useAsk } from './hooks/useAsk';
import { useItems } from './hooks/useItems';

export function App() {
  const { items, total, hasMore, loading, loadingMore, error, add, remove, loadMore } = useItems();
  const { result, asking, error: askError, ask } = useAsk();

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 sm:p-8">
      <header>
        <h1 className="text-2xl font-bold">AI Knowledge Inbox</h1>
        <p className="text-sm text-slate-500">Save notes and links, then ask questions answered from your own content.</p>
      </header>
      <ErrorBanner message={error} />
      <div className="grid gap-6 md:grid-cols-2">
        <div className="space-y-6">
          <AddItemForm onAdd={add} />
          <ItemList
            items={items}
            total={total}
            loading={loading}
            hasMore={hasMore}
            loadingMore={loadingMore}
            onLoadMore={() => void loadMore()}
            onDelete={(id) => void remove(id)}
          />
        </div>
        <AskPanel onAsk={(q) => void ask(q)} asking={asking} result={result} error={askError} />
      </div>
    </main>
  );
}
