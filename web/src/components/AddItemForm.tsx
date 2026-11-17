import { useState, type FormEvent } from 'react';
import type { IngestInput } from '../api/types';
import { ErrorBanner } from './ErrorBanner';

const MAX_NOTE_CHARS = 20_000;

interface Props {
  onAdd: (input: IngestInput) => Promise<void>;
}

/** Returns an error message for obviously bad input so we can fail fast before the network call. */
export function validateInput(mode: 'note' | 'url', value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return mode === 'note' ? 'Write a note first.' : 'Enter a URL first.';
  if (mode === 'note' && trimmed.length > MAX_NOTE_CHARS) return `Notes are limited to ${MAX_NOTE_CHARS} characters.`;
  if (mode === 'url' && !/^https?:\/\/\S+$/i.test(trimmed)) return 'URL must start with http:// or https://';
  return null;
}

export function AddItemForm({ onAdd }: Props) {
  const [mode, setMode] = useState<'note' | 'url'>('note');
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const problem = validateInput(mode, value);
    if (problem) return setError(problem);

    setSubmitting(true);
    setError(null);
    try {
      await onAdd(mode === 'note' ? { type: 'note', content: value.trim() } : { type: 'url', url: value.trim() });
      setValue('');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h2 className="font-semibold">Add to your inbox</h2>
      <div role="tablist" className="flex gap-2">
        {(['note', 'url'] as const).map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={mode === m}
            onClick={() => {
              setMode(m);
              setError(null);
            }}
            className={`rounded px-3 py-1 text-sm ${mode === m ? 'bg-slate-900 text-white' : 'bg-slate-100 hover:bg-slate-200'}`}
          >
            {m === 'note' ? 'Note' : 'URL'}
          </button>
        ))}
      </div>

      {mode === 'note' ? (
        <textarea
          aria-label="Note"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={4}
          placeholder="Paste or type something you want to remember…"
          className="w-full rounded border border-slate-300 p-2 text-sm"
        />
      ) : (
        <input
          aria-label="URL"
          type="url"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="https://example.com/article"
          className="w-full rounded border border-slate-300 p-2 text-sm"
        />
      )}

      <ErrorBanner message={error} />
      <button
        type="submit"
        disabled={submitting}
        className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
      >
        {submitting ? 'Saving…' : mode === 'note' ? 'Save note' : 'Save URL'}
      </button>
    </form>
  );
}
