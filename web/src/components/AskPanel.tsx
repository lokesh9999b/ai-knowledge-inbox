import { useState, type FormEvent } from 'react';
import type { QueryResult } from '../api/types';
import { AnswerCard } from './AnswerCard';
import { ErrorBanner } from './ErrorBanner';

interface Props {
  onAsk: (question: string) => void;
  asking: boolean;
  result: QueryResult | null;
  error: string | null;
}

export function AskPanel({ onAsk, asking, result, error }: Props) {
  const [question, setQuestion] = useState('');

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (question.trim().length >= 3) onAsk(question.trim());
  }

  return (
    <section aria-labelledby="ask-heading" className="space-y-3">
      <form onSubmit={handleSubmit} className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
        <h2 id="ask-heading" className="font-semibold">
          Ask your inbox
        </h2>
        <input
          aria-label="Question"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What do my notes say about…?"
          maxLength={1000}
          className="w-full rounded border border-slate-300 p-2 text-sm"
        />
        <button
          type="submit"
          disabled={asking || question.trim().length < 3}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
        >
          {asking ? 'Thinking…' : 'Ask'}
        </button>
      </form>
      <ErrorBanner message={error} />
      {result && <AnswerCard result={result} />}
    </section>
  );
}
