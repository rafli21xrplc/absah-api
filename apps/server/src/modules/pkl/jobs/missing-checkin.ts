import type { Logger } from 'pino';
import { remindMissingCheckins } from '../application/reviews';

/** pkl.missing-checkin: every 5 minutes (UTC); each school reminds from 10.00 on its own clock (PKL-02). */
export const MISSING_CHECKIN_QUEUE = 'pkl.missing-checkin';
export const MISSING_CHECKIN_CRON = '*/5 * * * *';

export function missingCheckinHandler(logger: Logger) {
  return async (): Promise<void> => {
    const reminded = await remindMissingCheckins(new Date(), logger);
    if (reminded > 0) logger.info({ queue: MISSING_CHECKIN_QUEUE, reminded }, 'pkl check-in reminders emitted');
  };
}
