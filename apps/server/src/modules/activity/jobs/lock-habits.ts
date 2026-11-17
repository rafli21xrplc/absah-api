import type { Logger } from 'pino';
import { lockHabits } from '../application/habits';

export const LOCK_HABITS_QUEUE = 'keg.lock-habits';
/** 00.30 WIB; WITA and WIT are already past midnight then, and each school's own date is used. */
export const LOCK_HABITS_CRON = '30 0 * * *';

export function lockHabitsHandler(logger: Logger) {
  return async (): Promise<void> => {
    logger.info({ locked: await lockHabits(), queue: LOCK_HABITS_QUEUE }, 'old habit entries locked');
  };
}
