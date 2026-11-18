import type { Logger } from 'pino';
import { autoConfirmDue } from '../application/supervision';

/** pkl.auto-confirm: every hour, check-ins pending for 24 hours without a dispute are confirmed (PKL-02). */
export const AUTO_CONFIRM_QUEUE = 'pkl.auto-confirm';
export const AUTO_CONFIRM_CRON = '7 * * * *';

export function autoConfirmHandler(logger: Logger) {
  return async (): Promise<void> => {
    const confirmed = await autoConfirmDue(new Date(), logger);
    if (confirmed > 0) logger.info({ queue: AUTO_CONFIRM_QUEUE, confirmed }, 'pkl check-ins auto-confirmed');
  };
}
