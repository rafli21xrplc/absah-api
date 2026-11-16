import { createApp } from '../app';
import { createAuth } from '../modules/platform';
import { loadConfig } from '../shared/config';
import { initCrypto } from '../shared/crypto';
import { closeDb, initDb } from '../shared/db';
import { createLogger } from '../shared/logger';
import { FakeMessageSender } from '../shared/messaging/message-sender';
import { createObjectStorage } from '../shared/storage';

const config = loadConfig();
const logger = createLogger({ level: config.LOG_LEVEL, pretty: config.NODE_ENV === 'development' });
initCrypto(config);
const { db } = initDb(config);

if (config.NODE_ENV === 'production') {
  // The WhatsApp provider adapter arrives with prompt 3.2; refuse to run production without it.
  throw new Error('No production MessageSender configured yet (prompt 3.2)');
}
// Dev: OTP codes are kept in memory and logged at debug level for local testing only.
const messageSender = new (class extends FakeMessageSender {
  override async sendOtp(input: { to: string; code: string; purpose: 'login' }): Promise<void> {
    await super.sendOtp(input);
    logger.debug({ devOtp: input.code }, 'dev OTP generated (FakeMessageSender)');
  }
})();
const auth = createAuth({ db, config, messageSender });

const app = createApp({ logger, version: config.APP_VERSION, auth, ipHeaders: config.AUTH_IP_HEADERS, appUrl: config.BETTER_AUTH_URL, storage: createObjectStorage(config) });
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
