import type { Logger } from 'pino';
import { processStatusWebhooks } from '../application/webhooks';

export const NOTIFY_WEBHOOKS_QUEUE = 'notify.webhooks';
export const NOTIFY_WEBHOOKS_CRON = '* * * * *';

export function webhookHandler(logger: Logger) {
  return async () => {
    const { applied, waiting } = await processStatusWebhooks();
    if (applied > 0 || waiting > 0) logger.info({ applied, waiting, queue: NOTIFY_WEBHOOKS_QUEUE }, 'WhatsApp statuses applied');
  };
}
