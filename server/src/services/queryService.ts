import type { Logger } from '../logger.js';
import type { Source } from '../types.js';
import type { Answerer } from './answerer.js';
import type { VectorSearch } from './vectorSearch.js';

export interface QueryResult {
  answer: string;
  sources: Source[];
  usedFallback: boolean;
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
      return { answer: NO_RESULTS_ANSWER, sources: [], usedFallback: false };
    }
    const { answer, usedFallback } = await this.answerer.answer(question, sources);
    this.logger.info({ sources: sources.length, usedFallback, ms: Date.now() - started }, 'query answered');
    return { answer, sources, usedFallback };
  }
}
