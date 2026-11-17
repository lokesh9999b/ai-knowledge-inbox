import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { buildDeps } from './container.js';
import { createLogger } from './logger.js';

const config = loadConfig();
const logger = createLogger(config.LOG_LEVEL);
const deps = buildDeps(config, logger);
const app = createApp(deps);

const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT, embedder: config.EMBEDDER, llm: config.GROQ_API_KEY ? config.GROQ_MODEL : 'none' }, 'server listening');
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'shutting down');
  server.close();
  await deps.queue.idle();
  process.exit(0);
}
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
