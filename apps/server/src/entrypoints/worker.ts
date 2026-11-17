import { PgBoss } from 'pg-boss';
import { academicConsumers, IMPORT_RETENTION_QUEUE, importRetentionHandler } from '../modules/academic';
import { ATTENDANCE_JOB_CRON, attendanceConsumers, attendanceJobHandlers } from '../modules/attendance';
import {
  HEARTBEAT_QUEUE,
  IDEMPOTENCY_CLEANUP_QUEUE,
  heartbeatHandler,
  idempotencyCleanupHandler,
} from '../modules/platform';
import { NOTIFY_RELEASE_CRON, NOTIFY_RELEASE_QUEUE, NOTIFY_WEBHOOKS_CRON, NOTIFY_WEBHOOKS_QUEUE, notifyConsumers, releaseHandler, webhookHandler } from '../modules/notify';
import { PICKUP_PHOTOS_QUEUE, pickupPhotosHandler, VISITOR_PHOTOS_QUEUE, visitorPhotosHandler } from '../modules/gate';
import {
  EXPORT_RETENTION_QUEUE,
  exportRetentionHandler,
  MBG_CUTOFF_CRON,
  MBG_CUTOFF_QUEUE,
  MBG_FORECAST_CRON,
  MBG_FORECAST_QUEUE,
  mbgCutoffHandler,
  mbgForecastHandler,
  reportConsumers,
} from '../modules/report';
import {
  APPLY_PAYMENTS_CRON,
  APPLY_PAYMENTS_QUEUE,
  applyPaymentsHandler,
  ISSUE_INVOICES_CRON,
  ISSUE_INVOICES_QUEUE,
  issueInvoicesHandler,
  subscriptionConsumers,
} from '../modules/subscription';
import { createPaymentProvider } from '../shared/payments';
import { loadConfig } from '../shared/config';
import { createMessageSender } from '../shared/messaging';
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
await boss.createQueue(EXPORT_RETENTION_QUEUE);
await boss.work(EXPORT_RETENTION_QUEUE, exportRetentionHandler(storage, logger));
await boss.schedule(EXPORT_RETENTION_QUEUE, '50 2 * * *', null, { tz: 'Asia/Jakarta' });
await boss.createQueue(VISITOR_PHOTOS_QUEUE);
await boss.work(VISITOR_PHOTOS_QUEUE, visitorPhotosHandler(storage, logger));
await boss.schedule(VISITOR_PHOTOS_QUEUE, '55 2 * * *', null, { tz: 'Asia/Jakarta' });
await boss.createQueue(PICKUP_PHOTOS_QUEUE);
await boss.work(PICKUP_PHOTOS_QUEUE, pickupPhotosHandler(storage, logger));
await boss.schedule(PICKUP_PHOTOS_QUEUE, '50 2 * * *', null, { tz: 'Asia/Jakarta' });
// Workspace invoices: 07.00 WIB on the 1st (days 2-7 only catch up).
await boss.createQueue(ISSUE_INVOICES_QUEUE);
await boss.work(ISSUE_INVOICES_QUEUE, issueInvoicesHandler(logger));
await boss.schedule(ISSUE_INVOICES_QUEUE, ISSUE_INVOICES_CRON, null, { tz: 'Asia/Jakarta' });

// Attendance jobs run every 5 minutes and act on each school's own clock (UTC cron on purpose).
for (const [queue, handler] of Object.entries(attendanceJobHandlers(logger))) {
  await boss.createQueue(queue);
  await boss.work(queue, handler);
  await boss.schedule(queue, ATTENDANCE_JOB_CRON, null, { tz: 'UTC' });
}

// MBG counts at each school's cutoff time (same per-school clock as the attendance jobs).
await boss.createQueue(MBG_CUTOFF_QUEUE);
await boss.work(MBG_CUTOFF_QUEUE, mbgCutoffHandler(logger));
await boss.schedule(MBG_CUTOFF_QUEUE, MBG_CUTOFF_CRON, null, { tz: 'UTC' });
await boss.createQueue(MBG_FORECAST_QUEUE);
await boss.work(MBG_FORECAST_QUEUE, mbgForecastHandler(logger));
await boss.schedule(MBG_FORECAST_QUEUE, MBG_FORECAST_CRON, null, { tz: 'UTC' });

// Quiet-hour messages are released every minute.
await boss.createQueue(NOTIFY_RELEASE_QUEUE);
await boss.work(NOTIFY_RELEASE_QUEUE, releaseHandler(logger));
await boss.schedule(NOTIFY_RELEASE_QUEUE, NOTIFY_RELEASE_CRON, null, { tz: 'UTC' });
// WhatsApp status webhooks stored by the API are applied every minute.
await boss.createQueue(NOTIFY_WEBHOOKS_QUEUE);
await boss.work(NOTIFY_WEBHOOKS_QUEUE, webhookHandler(logger));
await boss.schedule(NOTIFY_WEBHOOKS_QUEUE, NOTIFY_WEBHOOKS_CRON, null, { tz: 'UTC' });

// Gateway events stored by the API are applied every minute (BIL), when a gateway is configured.
const paymentProvider = createPaymentProvider(config);
if (paymentProvider) {
  await boss.createQueue(APPLY_PAYMENTS_QUEUE);
  await boss.work(APPLY_PAYMENTS_QUEUE, applyPaymentsHandler(paymentProvider, logger));
  await boss.schedule(APPLY_PAYMENTS_QUEUE, APPLY_PAYMENTS_CRON, null, { tz: 'UTC' });
}

// Outbox consumers from every module.
const sender = createMessageSender(config, logger);
const consumers: Consumer[] = [
  ...academicConsumers(storage),
  ...attendanceConsumers(),
  ...reportConsumers(storage),
  ...subscriptionConsumers(paymentProvider),
  ...notifyConsumers({ sender, appUrl: config.BETTER_AUTH_URL }),
];
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
