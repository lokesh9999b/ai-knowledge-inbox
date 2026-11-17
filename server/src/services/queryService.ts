import type { Logger } from '../logger.js';
import type { Source } from '../types.js';
import type { Answer, Answerer } from './answerer.js';
import type { VectorSearch } from './vectorSearch.js';

export interface QueryResult extends Pick<Answer, 'answer' | 'usedFallback' | 'notice'> {
  sources: Source[];
  /** Which provider answered (`groq:...`, `fallback:...`, `extractive`); null when no LLM was needed. */
  answeredBy: string | null;
}

export const NO_RESULTS_ANSWER = "I couldn't find anything relevant to that question in your saved content.";

export class QueryService {
  constructor(
    private readonly search: VectorSearch,
    private readonly answerer: Answerer,
    private readonly logger: Logger,
  ) {}

  async ask(question: string, topK: number): Promise<QueryResult> {
    const started = Date.now();
    const sources = await this.search.search(question, topK);
    if (sources.length === 0) {
      this.logger.info({ sources: 0 }, 'query had no relevant chunks; skipping LLM');
      return { answer: NO_RESULTS_ANSWER, sources: [], usedFallback: false, answeredBy: null };
    }
    const { answer, usedFallback, answeredBy, notice } = await this.answerer.answer(question, sources);
    this.logger.info({ sources: sources.length, usedFallback, answeredBy, ms: Date.now() - started }, 'query answered');
    return { answer, sources, usedFallback, answeredBy, notice };
  }
}
