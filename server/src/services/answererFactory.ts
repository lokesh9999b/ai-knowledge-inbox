import type { Config } from '../config.js';
import type { Logger } from '../logger.js';
import { ChatAnswerer, ExtractiveAnswerer, type Answerer } from './answerer.js';
import { ChainAnswerer, type NamedAnswerer } from './answererChain.js';

const GROQ_BASE_URL = 'https://api.groq.com/openai/v1';
const BREAKER = { failureThreshold: 3, cooldownMs: 30_000 };

export const NOT_CONFIGURED_NOTICE =
  'No language model is configured (set OPENAI_API_KEY or GROQ_API_KEY), so this is the most relevant saved passage instead of a generated answer.';
export const DEGRADED_NOTICE =
  'The language model was slow or unavailable, so this is the most relevant saved passage instead of a generated answer.';

export interface ProviderPlan {
  /** Reported as `answeredBy`, e.g. `openai:gpt-4o-mini`. */
  name: string;
  apiKey: string;
  baseURL: string;
  model: string;
}

/**
 * The providers to try, in order, given what is configured. Providers without a key are simply absent, so the
 * chain starts at the first one that is configured:
 *   1. OpenAI (main)
 *   2. Groq primary model
 *   3. Groq backup model (rate limits are per model, so this absorbs a primary 429)
 *   4. Optional extra OpenAI-compatible provider (e.g. Hugging Face's router) from FALLBACK_LLM_*
 * and after all of them, the extractive answer (always works, no network).
 */
export function providerPlan(config: Config): ProviderPlan[] {
  const plan: ProviderPlan[] = [];
  if (config.OPENAI_API_KEY) {
    plan.push({ name: `openai:${config.OPENAI_MODEL}`, apiKey: config.OPENAI_API_KEY, baseURL: config.OPENAI_BASE_URL, model: config.OPENAI_MODEL });
  }
  if (config.GROQ_API_KEY) {
    plan.push({ name: `groq:${config.GROQ_MODEL}`, apiKey: config.GROQ_API_KEY, baseURL: GROQ_BASE_URL, model: config.GROQ_MODEL });
    if (config.GROQ_FALLBACK_MODEL && config.GROQ_FALLBACK_MODEL !== config.GROQ_MODEL) {
      plan.push({
        name: `groq:${config.GROQ_FALLBACK_MODEL}`,
        apiKey: config.GROQ_API_KEY,
        baseURL: GROQ_BASE_URL,
        model: config.GROQ_FALLBACK_MODEL,
      });
    }
  }
  if (config.FALLBACK_LLM_BASE_URL && config.FALLBACK_LLM_API_KEY && config.FALLBACK_LLM_MODEL) {
    plan.push({
      name: `fallback:${config.FALLBACK_LLM_MODEL}`,
      apiKey: config.FALLBACK_LLM_API_KEY,
      baseURL: config.FALLBACK_LLM_BASE_URL,
      model: config.FALLBACK_LLM_MODEL,
    });
  }
  return plan;
}

export function createAnswerer(config: Config, logger: Logger): Answerer {
  const plan = providerPlan(config);
  if (plan.length === 0) {
    logger.warn('no LLM configured (set OPENAI_API_KEY or GROQ_API_KEY): answers will be extractive');
    return new ExtractiveAnswerer(NOT_CONFIGURED_NOTICE);
  }
  logger.info({ chain: [...plan.map((p) => p.name), 'extractive'] }, 'LLM chain configured');

  const providers: NamedAnswerer[] = plan.map((p) => ({
    name: p.name,
    answerer: new ChatAnswerer({ ...p, timeoutMs: config.LLM_TIMEOUT_MS }, logger),
  }));
  return new ChainAnswerer(providers, new ExtractiveAnswerer(DEGRADED_NOTICE), logger, {
    ...BREAKER,
    deadlineMs: config.LLM_DEADLINE_MS,
  });
}
