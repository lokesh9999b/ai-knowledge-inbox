import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { buildDeps } from './container.js';
import { createLogger } from './logger.js';
import { providerPlan } from './services/answererFactory.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const deps = buildDeps(config, logger);
const app = createApp(deps);

const server = app.listen(config.PORT, () => {
  logger.info(
    {
      port: config.PORT,
      embedder: config.EMBEDDER,
      embedWorkers: config.EMBEDDER === 'local' ? config.EMBED_WORKERS : 0,
      llmProviders: providerPlan(config).map((p) => p.name), // empty = extractive answers only
    },
    'server listening',
  );
  deps.lifecycle.warmUp(); // load the embedding model now, not on the first request
});

let shuttingDown = false;
async function shutdown(signal: string): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, 'shutting down');
  server.close();
  await deps.lifecycle.close(); // finish queued indexing, then stop the embedding workers before exiting
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
