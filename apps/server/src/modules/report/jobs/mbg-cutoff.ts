import type { Logger } from 'pino';
import { countDueCutoffs } from '../application/mbg-cutoff';

/** rkp.mbg-cutoff: every 5 minutes in UTC; each school is counted at its own cutoff (RKP-08). */
export const MBG_CUTOFF_QUEUE = 'rkp.mbg-cutoff';
export const MBG_CUTOFF_CRON = '*/5 * * * *';

export function mbgCutoffHandler(logger: Logger) {
  return async (): Promise<void> => {
    const counted = await countDueCutoffs(new Date(), logger);
    if (counted > 0) logger.info({ queue: MBG_CUTOFF_QUEUE, schools: counted }, 'mbg counts stored');
  };
}
