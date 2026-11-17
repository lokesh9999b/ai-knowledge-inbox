import type { Config } from '../config.js';
import type { Logger } from '../logger.js';
import { ChatAnswerer, ExtractiveAnswerer, type Answerer } from './answerer.js';
import { ChainAnswerer, type NamedAnswerer } from './answererChain.js';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const BREAKER = { failureThreshold: 3, cooldownMs: 30_000 };

export const NOT_CONFIGURED_NOTICE =
  'No language model is configured (set GROQ_API_KEY), so this is the most relevant saved passage instead of a generated answer.';
export const DEGRADED_NOTICE =
  'The language model was slow or unavailable, so this is the most relevant saved passage instead of a generated answer.';

/**
 * Builds the answer chain from config, in order of preference:
 *   1. Groq primary model
 *   2. Groq backup model (rate limits are per model, so this absorbs a primary 429)
 *   3. Optional extra OpenAI-compatible provider (e.g. Hugging Face's router) from FALLBACK_LLM_*
 *   4. Extractive answer (always works, no network)
 */
export function createAnswerer(config: Config, logger: Logger): Answerer {
  const providers: NamedAnswerer[] = [];
  const add = (name: string, apiKey: string, baseURL: string, model: string) =>
    providers.push({
      name,
      answerer: new ChatAnswerer({ name, apiKey, baseURL, model, timeoutMs: config.LLM_TIMEOUT_MS }, logger),
    });

  if (config.GROQ_API_KEY) {
    add(`groq:${config.GROQ_MODEL}`, config.GROQ_API_KEY, GROQ_BASE_URL, config.GROQ_MODEL);
    if (config.GROQ_FALLBACK_MODEL && config.GROQ_FALLBACK_MODEL !== config.GROQ_MODEL) {
      add(`groq:${config.GROQ_FALLBACK_MODEL}`, config.GROQ_API_KEY, GROQ_BASE_URL, config.GROQ_FALLBACK_MODEL);
    }
  }
  if (config.FALLBACK_LLM_BASE_URL && config.FALLBACK_LLM_API_KEY && config.FALLBACK_LLM_MODEL) {
    add(`fallback:${config.FALLBACK_LLM_MODEL}`, config.FALLBACK_LLM_API_KEY, config.FALLBACK_LLM_BASE_URL, config.FALLBACK_LLM_MODEL);
  }

  if (providers.length === 0) {
    logger.warn('no LLM configured (GROQ_API_KEY unset): answers will be extractive');
    return new ExtractiveAnswerer(NOT_CONFIGURED_NOTICE);
  }
  return new ChainAnswerer(providers, new ExtractiveAnswerer(DEGRADED_NOTICE), logger, {
    ...BREAKER,
    deadlineMs: config.LLM_DEADLINE_MS,
  });
}
