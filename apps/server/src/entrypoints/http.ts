import { createApp } from '../app';
import { loadConfig } from '../shared/config';
import { closeDb, initDb } from '../shared/db';
import { createLogger } from '../shared/logger';

const config = loadConfig();
const logger = createLogger({ level: config.LOG_LEVEL, pretty: config.NODE_ENV === 'development' });
initDb(config);

const app = createApp({ logger, version: config.APP_VERSION });
const server = app.listen(config.PORT, () => {
  logger.info({ port: config.PORT }, 'http listening');
});

let stopping = false;
function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'http shutting down');
  server.close(() => {
    void closeDb().finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
