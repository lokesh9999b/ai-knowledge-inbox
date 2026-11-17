import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  DB_PATH: z.string().default('./data/inbox.db'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Per-IP requests/minute on /ingest and /query. 0 disables the limiter (load tests only). */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(0).default(60),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  EMBEDDER: z.enum(['local', 'hash']).default('local'),
  /**
   * Worker threads running the local embedding model. 0 = run it on the main thread.
   * Default 1: measured fastest. The model already uses every core, so more workers only oversubscribe the CPU.
   */
  EMBED_WORKERS: z.coerce.number().int().min(0).max(8).default(1),
  /** Directory holding the cached embedding model files. Unset = the library default (downloaded on first use). */
  MODEL_CACHE_DIR: z.string().optional(),
  /** Main provider when set. Optional: without a key the chain simply starts at Groq. */
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_MODEL: z.string().default('gpt-4o-mini'),
  /** Override for Azure OpenAI, a proxy, or any OpenAI-compatible gateway. */
  OPENAI_BASE_URL: z.string().default('https://api.openai.com/v1'),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),
  /** Backup Groq model tried when the primary fails or is rate limited (limits are per model). Empty disables. */
  GROQ_FALLBACK_MODEL: z.string().default('openai/gpt-oss-20b'),
  /** Per-attempt time budget for one LLM call; a slower provider counts as failed and the next one is tried. */
  LLM_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(6_000),
  /** Hard cap on the whole LLM step across every provider, so a slow chain can never hold a request longer than this. */
  LLM_DEADLINE_MS: z.coerce.number().int().min(500).max(120_000).default(10_000),
  /**
   * Optional extra provider, tried after Groq. Any OpenAI-compatible endpoint, e.g. Hugging Face:
   * FALLBACK_LLM_BASE_URL=https://router.huggingface.co/v1, FALLBACK_LLM_API_KEY=<HF token>, FALLBACK_LLM_MODEL=<model id>.
   * All three must be set together.
   */
  FALLBACK_LLM_BASE_URL: z.string().optional(),
  FALLBACK_LLM_API_KEY: z.string().optional(),
  FALLBACK_LLM_MODEL: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  // Treat empty values (as in .env.example) as "not set".
  const data = {
    ...parsed.data,
    MODEL_CACHE_DIR: parsed.data.MODEL_CACHE_DIR || undefined,
    OPENAI_API_KEY: parsed.data.OPENAI_API_KEY || undefined,
    GROQ_API_KEY: parsed.data.GROQ_API_KEY || undefined,
    FALLBACK_LLM_BASE_URL: parsed.data.FALLBACK_LLM_BASE_URL || undefined,
    FALLBACK_LLM_API_KEY: parsed.data.FALLBACK_LLM_API_KEY || undefined,
    FALLBACK_LLM_MODEL: parsed.data.FALLBACK_LLM_MODEL || undefined,
  };
  const fallbackSet = [data.FALLBACK_LLM_BASE_URL, data.FALLBACK_LLM_API_KEY, data.FALLBACK_LLM_MODEL].filter(Boolean).length;
  if (fallbackSet !== 0 && fallbackSet !== 3) {
    throw new Error(
      'Invalid environment configuration: FALLBACK_LLM_BASE_URL, FALLBACK_LLM_API_KEY and FALLBACK_LLM_MODEL must be set together',
    );
  }
  return data;
}
