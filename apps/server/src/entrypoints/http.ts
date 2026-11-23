import { createApp } from '../app';
import { createAuth } from '../modules/platform';
import { loadConfig } from '../shared/config';
import { initCrypto } from '../shared/crypto';
import { closeDb, initDb } from '../shared/db';
import { createLogger } from '../shared/logger';
import { createMessageSender } from '../shared/messaging';
import { createObjectStorage } from '../shared/storage';

const config = loadConfig();
const logger = createLogger({ level: config.LOG_LEVEL, pretty: config.NODE_ENV === 'development' });
initCrypto(config);
const { db } = initDb(config);

// Login OTP goes out inline (the one exception to "no provider calls in request handlers", see CLAUDE.md).
const messageSender = createMessageSender(config, logger);
const auth = createAuth({ db, config, messageSender });

const app = createApp({ logger, version: config.APP_VERSION, auth, ipHeaders: config.AUTH_IP_HEADERS, appUrl: config.BETTER_AUTH_URL, storage: createObjectStorage(config), kioskOrigins: config.KIOSK_ORIGINS,
  whatsappWebhook: config.WHATSAPP_APP_SECRET && config.WHATSAPP_VERIFY_TOKEN ? { appSecret: config.WHATSAPP_APP_SECRET, verifyToken: config.WHATSAPP_VERIFY_TOKEN } : undefined,
});
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
