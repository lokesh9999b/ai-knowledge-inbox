import OpenAI from 'openai';
import { AppError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { Source } from '../types.js';

export interface Answer {
  answer: string;
  /** true when no LLM produced the answer (no API key configured). */
  usedFallback: boolean;
}

export interface Answerer {
  answer(question: string, sources: Source[]): Promise<Answer>;
}

const SYSTEM_PROMPT = [
  "You answer questions using ONLY the numbered context passages from the user's saved notes and web pages.",
  'Cite the passages you rely on inline as [1], [2], etc.',
  'If the passages do not contain the answer, say you could not find it in the saved content. Do not use outside knowledge.',
  'Be concise.',
].join(' ');

export function buildContext(sources: Source[]): string {
  return sources
    .map((s, i) => `[${i + 1}] (${s.title}${s.sourceUrl ? `, ${s.sourceUrl}` : ''})\n${s.snippet}`)
    .join('\n\n');
}

/** Groq exposes an OpenAI-compatible API, so the OpenAI SDK is used with a different baseURL. */
export class GroqAnswerer implements Answerer {
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model: string,
    private readonly logger: Logger,
  ) {
    this.client = new OpenAI({ apiKey, baseURL: 'https://api.groq.com/openai/v1', timeout: 30_000, maxRetries: 1 });
  }

  async answer(question: string, sources: Source[]): Promise<Answer> {
    try {
      const completion = await this.client.chat.completions.create({
        model: this.model,
        temperature: 0.1,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: `Context:\n${buildContext(sources)}\n\nQuestion: ${question}` },
        ],
      });
      const text = completion.choices[0]?.message?.content?.trim();
      if (!text) throw new Error('empty completion');
      return { answer: text, usedFallback: false };
    } catch (err) {
      this.logger.error({ err, model: this.model }, 'LLM request failed');
      throw new AppError('UPSTREAM_ERROR', `The language model request failed: ${(err as Error).message}`);
    }
  }
}

/** No-LLM fallback: quotes the best passage so the app is still useful without an API key. */
export class ExtractiveAnswerer implements Answerer {
  async answer(_question: string, sources: Source[]): Promise<Answer> {
    const best = sources[0];
    const answer = best
      ? `No LLM is configured (set GROQ_API_KEY), so here is the most relevant saved passage: "${best.snippet}" [1]`
      : 'No relevant saved content found.';
    return { answer, usedFallback: true };
  }
}
