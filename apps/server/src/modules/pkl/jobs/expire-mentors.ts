import type { Logger } from 'pino';
import { expireIndustryMentors } from '../application/placements';

/** pkl.expire-mentors: 00.05 WIB daily; each school uses its own date (PKL-01). */
export const EXPIRE_MENTORS_QUEUE = 'pkl.expire-mentors';
export const EXPIRE_MENTORS_CRON = '5 0 * * *';

export function expireMentorsHandler(logger: Logger) {
  return async (): Promise<void> => {
    const suspended = await expireIndustryMentors(new Date(), logger);
    if (suspended > 0) logger.info({ queue: EXPIRE_MENTORS_QUEUE, suspended }, 'industry supervisors without a running placement suspended');
  };
}
