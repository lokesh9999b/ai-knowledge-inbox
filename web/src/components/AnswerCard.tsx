import type { QueryResult } from '../api/types';

/** Renders the answer and the retrieved chunks it was grounded on, numbered to match [n] citations. */
export function AnswerCard({ result }: { result: QueryResult }) {
  return (
    <div className="space-y-3 rounded-lg border border-slate-200 bg-white p-4">
      <h3 className="font-semibold">Answer</h3>
      <p className="whitespace-pre-wrap text-sm">{result.answer}</p>
      {result.notice && <p className="text-xs text-amber-700">{result.notice}</p>}
      {!result.notice && result.answeredBy && (
        <p className="text-xs text-slate-400">Answered by {result.answeredBy}</p>
      )}

      {result.sources.length > 0 && (
        <>
          <h3 className="pt-1 text-sm font-semibold text-slate-600">Sources</h3>
          <ol className="space-y-2">
            {result.sources.map((s, i) => (
              <li key={s.chunkId} className="rounded border border-slate-100 bg-slate-50 p-2 text-sm">
                <p className="font-medium">
                  <span className="mr-1 rounded bg-slate-200 px-1.5 text-xs">[{i + 1}]</span>
                  {s.sourceUrl ? (
                    <a href={s.sourceUrl} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">
                      {s.title}
                    </a>
                  ) : (
                    s.title
                  )}
                  <span className="ml-2 text-xs font-normal text-slate-400">relevance {s.score.toFixed(2)}</span>
                </p>
                <p className="mt-1 text-slate-600">“{s.snippet}”</p>
              </li>
            ))}
          </ol>
        </>
      )}
    </div>
  );
}
