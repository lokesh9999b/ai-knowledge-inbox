import { vi } from 'vitest';
import { createApp, type AppDeps } from '../src/app.js';
import { loadConfig } from '../src/config.js';
import { buildDeps } from '../src/container.js';
import { createLogger } from '../src/logger.js';
import { HashEmbedder } from '../src/services/embedder.js';
import type { Answerer } from '../src/services/answerer.js';
import type { UrlFetcher } from '../src/services/urlFetcher.js';

export const PAGE = 'https://93.184.216.34/guide'; // public IP literal: no DNS needed

/** Builds the real app on an in-memory DB with a hash embedder, a stub LLM and a stub fetcher. */
export function setup(overrides: { answerer?: Answerer; fetcher?: UrlFetcher } = {}) {
  const config = loadConfig({ DB_PATH: ':memory:', EMBEDDER: 'hash', LOG_LEVEL: 'silent' });
  const answerer: Answerer = overrides.answerer ?? {
    answer: vi.fn(async (_q, sources) => ({ answer: `Answer based on ${sources[0]!.title} [1]`, usedFallback: false })),
  };
  const fetcher: UrlFetcher = overrides.fetcher ?? {
    fetchPage: vi.fn(async () => ({
      title: 'Rust Guide',
      text: 'Rust is a systems programming language focused on memory safety without garbage collection.',
    })),
  };
  const deps: AppDeps = buildDeps(config, createLogger('silent'), {
    embedder: new HashEmbedder(),
    answerer,
    fetcher,
    rateLimitPerMinute: 0,
  });
  return { app: createApp(deps), deps, answerer, fetcher };
}
