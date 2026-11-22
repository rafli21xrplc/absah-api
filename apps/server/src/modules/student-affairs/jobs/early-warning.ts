import type { Logger } from 'pino';
import { raiseEarlyWarnings } from '../application/early-warning';

/** ksw.early-warning: every 5 minutes (UTC); each school is looked at once a day from 18.00 on its own clock (KSW-04). */
export const EARLY_WARNING_QUEUE = 'ksw.early-warning';
export const EARLY_WARNING_CRON = '*/5 * * * *';

export function earlyWarningHandler(logger: Logger) {
  return async (): Promise<void> => {
    const raised = await raiseEarlyWarnings(new Date(), logger);
    if (raised > 0) logger.info({ queue: EARLY_WARNING_QUEUE, raised }, 'early warnings raised');
  };
}
