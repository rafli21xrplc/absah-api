import type { Logger } from 'pino';
import type { PaymentProvider } from '../../../shared/payments';
import { applyStudentPaymentWebhooks } from '../application/payments';

/** tgh.apply-payments: every minute, gateway events from the inbox to student payments, installments and bills. */
export const APPLY_STUDENT_PAYMENTS_QUEUE = 'tgh.apply-payments';
export const APPLY_STUDENT_PAYMENTS_CRON = '* * * * *';

export function applyStudentPaymentsHandler(provider: PaymentProvider, logger: Logger) {
  return async (): Promise<void> => {
    const { applied } = await applyStudentPaymentWebhooks(provider);
    if (applied > 0) logger.info({ queue: APPLY_STUDENT_PAYMENTS_QUEUE, applied }, 'student payment webhooks applied');
  };
}
