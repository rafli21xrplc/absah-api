import { PgBoss } from 'pg-boss';
import { academicConsumers, IMPORT_RETENTION_QUEUE, importRetentionHandler } from '../modules/academic';
import { ATTENDANCE_JOB_CRON, attendanceJobHandlers } from '../modules/attendance';
import {
  HEARTBEAT_QUEUE,
  IDEMPOTENCY_CLEANUP_QUEUE,
  heartbeatHandler,
  idempotencyCleanupHandler,
} from '../modules/platform';
import { loadConfig } from '../shared/config';
import { initCrypto } from '../shared/crypto';
import { closeDb, initDb } from '../shared/db';
import { deleteOldOutboxRows, OUTBOX_RETENTION_QUEUE, startOutbox, type Consumer } from '../shared/outbox';
import { createLogger } from '../shared/logger';
import { createObjectStorage } from '../shared/storage';

const config = loadConfig();
const logger = createLogger({ level: config.LOG_LEVEL, pretty: config.NODE_ENV === 'development' }).child({
  process: 'worker',
});
initCrypto(config);
initDb(config);

// pg-boss keeps its own schema (pgboss) in the same Postgres. Direct URL avoids pooler limits.
const boss = new PgBoss({ connectionString: config.DATABASE_URL_DIRECT ?? config.DATABASE_URL, schema: 'pgboss' });
boss.on('error', (err) => logger.error({ err }, 'pg-boss error'));

await boss.start();
await boss.createQueue(HEARTBEAT_QUEUE);
await boss.work(HEARTBEAT_QUEUE, heartbeatHandler(logger));
await boss.schedule(HEARTBEAT_QUEUE, '*/5 * * * *', null, { tz: 'Asia/Jakarta' });
await boss.createQueue(IDEMPOTENCY_CLEANUP_QUEUE);
await boss.work(IDEMPOTENCY_CLEANUP_QUEUE, idempotencyCleanupHandler(logger));
await boss.schedule(IDEMPOTENCY_CLEANUP_QUEUE, '17 * * * *', null, { tz: 'Asia/Jakarta' });
await boss.createQueue(OUTBOX_RETENTION_QUEUE);
await boss.work(OUTBOX_RETENTION_QUEUE, async () => {
  logger.info({ deleted: await deleteOldOutboxRows(), queue: OUTBOX_RETENTION_QUEUE }, 'old outbox rows deleted');
});
await boss.schedule(OUTBOX_RETENTION_QUEUE, '30 2 * * *', null, { tz: 'Asia/Jakarta' });

const storage = createObjectStorage(config);
await boss.createQueue(IMPORT_RETENTION_QUEUE);
await boss.work(IMPORT_RETENTION_QUEUE, importRetentionHandler(storage, logger));
await boss.schedule(IMPORT_RETENTION_QUEUE, '45 2 * * *', null, { tz: 'Asia/Jakarta' });

// Attendance jobs run every 5 minutes and act on each school's own clock (UTC cron on purpose).
for (const [queue, handler] of Object.entries(attendanceJobHandlers(logger))) {
  await boss.createQueue(queue);
  await boss.work(queue, handler);
  await boss.schedule(queue, ATTENDANCE_JOB_CRON, null, { tz: 'UTC' });
}

// Outbox consumers from every module.
const consumers: Consumer[] = [...academicConsumers(storage)];
const outbox = await startOutbox(boss, consumers, logger);
logger.info('worker started');

let stopping = false;
async function shutdown(signal: string): Promise<void> {
  if (stopping) return;
  stopping = true;
  logger.info({ signal }, 'worker shutting down');
  try {
    await outbox.stop();
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
