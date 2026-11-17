import cors from 'cors';
import express, { type Express } from 'express';
import { rateLimit } from 'express-rate-limit';
import { randomUUID } from 'node:crypto';
import { pinoHttp } from 'pino-http';
import type { ChunksRepo } from './db/chunksRepo.js';
import type { ItemsRepo } from './db/itemsRepo.js';
import type { Logger } from './logger.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { ingestRouter } from './routes/ingest.js';
import { itemsRouter } from './routes/items.js';
import { queryRouter } from './routes/query.js';
import type { IngestService } from './services/ingestService.js';
import type { JobQueue } from './services/jobQueue.js';
import type { QueryService } from './services/queryService.js';

export interface AppDeps {
  logger: Logger;
  items: ItemsRepo;
  chunks: ChunksRepo;
  ingest: IngestService;
  query: QueryService;
  queue: JobQueue;
  corsOrigin: string;
  /** Requests per minute per IP on the write/AI endpoints; 0 disables (tests). */
  rateLimitPerMinute: number;
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  app.disable('x-powered-by');
  app.use(
    pinoHttp({
      logger: deps.logger,
      genReqId: (req, res) => {
        const id = (req.headers['x-request-id'] as string | undefined) ?? randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      autoLogging: { ignore: (req) => req.url === '/health' },
    }),
  );
  app.use(cors({ origin: deps.corsOrigin }));
  app.use(express.json({ limit: '100kb' }));

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', pendingJobs: deps.queue.size });
  });

  if (deps.rateLimitPerMinute > 0) {
    const limiter = rateLimit({
      windowMs: 60_000,
      limit: deps.rateLimitPerMinute,
      standardHeaders: true,
      legacyHeaders: false,
      handler: (_req, res) =>
        res.status(429).json({ error: { code: 'RATE_LIMITED', message: 'Too many requests, slow down and retry shortly' } }),
    });
    app.use(['/ingest', '/query'], limiter);
  }

  app.use(ingestRouter(deps.ingest));
  app.use(itemsRouter(deps.items));
  app.use(queryRouter(deps.query));
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
