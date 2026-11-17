import { ChunksRepo } from './db/chunksRepo.js';
import { openDb } from './db/connection.js';
import { ItemsRepo } from './db/itemsRepo.js';
import type { Config } from './config.js';
import type { Logger } from './logger.js';
import { ExtractiveAnswerer, GroqAnswerer, type Answerer } from './services/answerer.js';
import { createEmbedder, type Embedder } from './services/embedder.js';
import { IngestService } from './services/ingestService.js';
import { JobQueue } from './services/jobQueue.js';
import { QueryService } from './services/queryService.js';
import { HttpUrlFetcher, type UrlFetcher } from './services/urlFetcher.js';
import { VectorSearch } from './services/vectorSearch.js';
import type { AppDeps } from './app.js';

export interface Overrides {
  embedder?: Embedder;
  answerer?: Answerer;
  fetcher?: UrlFetcher;
  rateLimitPerMinute?: number;
}

/** Composition root: the only place concrete implementations are wired together. */
export function buildDeps(config: Config, logger: Logger, overrides: Overrides = {}): AppDeps {
  const db = openDb(config.DB_PATH);
  const items = new ItemsRepo(db);
  const chunks = new ChunksRepo(db);
  const queue = new JobQueue(logger);
  const embedder = overrides.embedder ?? createEmbedder(config.EMBEDDER, logger);
  const fetcher = overrides.fetcher ?? new HttpUrlFetcher();
  const answerer =
    overrides.answerer ??
    (config.GROQ_API_KEY ? new GroqAnswerer(config.GROQ_API_KEY, config.GROQ_MODEL, logger) : new ExtractiveAnswerer());

  if (!config.GROQ_API_KEY && !overrides.answerer) {
    logger.warn('GROQ_API_KEY is not set: answers will be extractive (no LLM)');
  }

  // Items left "processing" by a previous crash can never finish (the queue is in-memory).
  db.prepare(`UPDATE items SET status = 'failed', error = 'Interrupted by server restart; delete and re-add' WHERE status = 'processing'`).run();

  return {
    logger,
    items,
    chunks,
    queue,
    ingest: new IngestService(items, chunks, embedder, fetcher, queue, logger),
    query: new QueryService(new VectorSearch(chunks, embedder), answerer, logger),
    corsOrigin: config.CORS_ORIGIN,
    rateLimitPerMinute: overrides.rateLimitPerMinute ?? 60,
  };
}
