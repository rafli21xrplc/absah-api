import type { Logger } from 'pino';
import { remindDueInstallments } from '../application/reminders';

/** tgh.remind-due: every 5 minutes (UTC); each school is looked at from 08.00 on its own clock (TGH-04). */
export const REMIND_DUE_QUEUE = 'tgh.remind-due';
export const REMIND_DUE_CRON = '*/5 * * * *';

export function remindDueHandler(logger: Logger) {
  return async (): Promise<void> => {
    const reminded = await remindDueInstallments(new Date(), logger);
    if (reminded > 0) logger.info({ queue: REMIND_DUE_QUEUE, reminded }, 'bill reminders queued');
  };
}
