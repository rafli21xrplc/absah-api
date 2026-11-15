import { PgBoss } from 'pg-boss';
import { HEARTBEAT_QUEUE, heartbeatHandler } from '../modules/platform';
import { loadConfig } from '../shared/config';
import { closeDb, initDb } from '../shared/db';
import { createLogger } from '../shared/logger';

const config = loadConfig();
const logger = createLogger({ level: config.LOG_LEVEL, pretty: config.NODE_ENV === 'development' }).child({
  process: 'worker',
});
initDb(config);

// pg-boss keeps its own schema (pgboss) in the same Postgres. Direct URL avoids pooler limits.
const boss = new PgBoss({ connectionString: config.DATABASE_URL_DIRECT ?? config.DATABASE_URL, schema: 'pgboss' });
boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));

await boss.start();
await boss.createQueue(HEARTBEAT_QUEUE);
await boss.work(HEARTBEAT_QUEUE, heartbeatHandler(logger));
await boss.schedule(HEARTBEAT_QUEUE, '*/5 * * * *', null, { tz: 'Asia/Jakarta' });
logger.info('worker started');

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'worker shutting down');
  try {
    await boss.stop({ graceful: true, timeout: 10_000 });
    await closeDb();
    process.exit(0);
  } catch (err) {
    logger.error({ err }, 'worker shutdown failed');
    process.exit(1);
  }
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
