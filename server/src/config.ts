import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3001),
  DB_PATH: z.string().default('./data/inbox.db'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  /** Per-IP requests/minute on /ingest and /query. 0 disables the limiter (load tests only). */
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().min(0).default(60),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  EMBEDDER: z.enum(['local', 'hash']).default('local'),
  GROQ_API_KEY: z.string().optional(),
  GROQ_MODEL: z.string().default('openai/gpt-oss-120b'),
});

export type Config = z.infer<typeof schema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${issues}`);
  }
  // Treat an empty key (as in .env.example) as "not set".
  return { ...parsed.data, GROQ_API_KEY: parsed.data.GROQ_API_KEY || undefined };
}
