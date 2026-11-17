import OpenAI from 'openai';
import { AppError } from '../errors.js';
import type { Logger } from '../logger.js';
import type { Source } from '../types.js';

export interface Answer {
  answer: string;
  /** true when no LLM produced the answer (the extractive last resort was used). */
  usedFallback: boolean;
  /** Which provider answered, e.g. `groq:openai/gpt-oss-120b`, or `extractive`. */
  answeredBy: string;
  /** User-facing explanation when the answer is degraded (backup model, or no LLM at all). */
  notice?: string;
}

export interface AnswerOptions {
  /** Aborts the attempt (used by the chain to enforce one overall deadline across all providers). */
  signal?: AbortSignal;
}

export interface Answerer {
  answer(question: string, sources: Source[], options?: AnswerOptions): Promise<Answer>;
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

const DEFAULT_RETRY_AFTER_SECONDS = 10;

interface HttpLikeError {
  status?: number;
  message?: string;
  headers?: Headers | Record<string, string | null | undefined>;
}

/**
 * Maps a provider failure to the right API error. A provider rate limit (HTTP 429) is a capacity signal the client
 * can act on, so it becomes our own 429 with a Retry-After hint instead of an opaque 502.
 */
export function toLlmError(err: unknown): AppError {
  const e = (err ?? {}) as HttpLikeError;
  if (e.status === 429) {
    const header = e.headers instanceof Headers ? e.headers.get('retry-after') : e.headers?.['retry-after'];
    const parsed = Number(header);
    const retryAfterSeconds = Number.isFinite(parsed) && parsed > 0 ? Math.ceil(parsed) : DEFAULT_RETRY_AFTER_SECONDS;
    return new AppError('RATE_LIMITED', `The language model is rate limited right now. Retry in about ${retryAfterSeconds}s.`, {
      retryAfterSeconds,
    });
  }
  return new AppError('UPSTREAM_ERROR', `The language model request failed: ${e.message ?? String(err)}`);
}

/** Some models emit full-width citation brackets (【1】); normalise to the [n] format the UI and prompt use. */
export function normaliseCitations(text: string): string {
  return text.replace(/【\s*(\d+)\s*】/g, '[$1]');
}

export interface ChatAnswererOptions {
  /** Label reported as `answeredBy`, e.g. `groq:openai/gpt-oss-120b`. */
  name: string;
  apiKey: string;
  /** Any OpenAI-compatible endpoint: Groq, Hugging Face's router, OpenRouter, a local server... */
  baseURL: string;
  model: string;
  /** Per-attempt time budget. A slow provider is treated as a failure so the next one can take over. */
  timeoutMs: number;
}

/** Answers with one chat model behind an OpenAI-compatible API. No SDK retries: the chain handles failover. */
export class ChatAnswerer implements Answerer {
  private readonly client: OpenAI;

  constructor(
    private readonly options: ChatAnswererOptions,
    private readonly logger: Pick<Logger, 'error'>,
  ) {
    this.client = new OpenAI({
      apiKey: options.apiKey,
      baseURL: options.baseURL,
      timeout: options.timeoutMs,
      maxRetries: 0,
    });
  }

  async answer(question: string, sources: Source[], options: AnswerOptions = {}): Promise<Answer> {
    try {
      const completion = await this.client.chat.completions.create(
        {
          model: this.options.model,
          temperature: 0.1,
          messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `Context:\n${buildContext(sources)}\n\nQuestion: ${question}` },
          ],
        },
        { signal: options.signal },
      );
      const text = completion.choices[0]?.message?.content?.trim();
      if (!text) throw new Error('empty completion');
      return { answer: normaliseCitations(text), usedFallback: false, answeredBy: this.options.name };
    } catch (err) {
      this.logger.error({ err, provider: this.options.name }, 'LLM request failed');
      throw toLlmError(err);
    }
  }
}

/** Last resort that cannot fail: quotes the best passage. `notice` says why no model answered. */
export class ExtractiveAnswerer implements Answerer {
  constructor(private readonly notice: string) {}

  async answer(_question: string, sources: Source[]): Promise<Answer> {
    const best = sources[0];
    const answer = best ? `Most relevant saved passage: "${best.snippet}" [1]` : 'No relevant saved content found.';
    return { answer, usedFallback: true, answeredBy: 'extractive', notice: this.notice };
  }
}
