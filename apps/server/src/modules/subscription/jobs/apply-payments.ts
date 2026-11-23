import type { Logger } from 'pino';
import type { PaymentProvider } from '../../../shared/payments';
import { applyPaymentWebhooks } from '../application/payments';

/** bil.apply-payments: every minute, gateway events from the inbox to payments and invoices. */
export const APPLY_PAYMENTS_QUEUE = 'bil.apply-payments';
export const APPLY_PAYMENTS_CRON = '* * * * *';

export function applyPaymentsHandler(provider: PaymentProvider, logger: Logger) {
  return async (): Promise<void> => {
    const { applied, waiting } = await applyPaymentWebhooks(provider);
    if (applied > 0 || waiting > 0) logger.info({ queue: APPLY_PAYMENTS_QUEUE, applied, waiting }, 'payment webhooks applied');
  };
}
