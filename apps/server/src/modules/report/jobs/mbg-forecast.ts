import type { Logger } from 'pino';
import { forecastDue } from '../application/mbg-forecast';

/** rkp.mbg-forecast: every 5 minutes in UTC; each school forecasts at 13.00 on its own clock (RKP-09). */
export const MBG_FORECAST_QUEUE = 'rkp.mbg-forecast';
export const MBG_FORECAST_CRON = '*/5 * * * *';

export function mbgForecastHandler(logger: Logger) {
  return async (): Promise<void> => {
    const done = await forecastDue(new Date(), logger);
    if (done > 0) logger.info({ queue: MBG_FORECAST_QUEUE, schools: done }, 'mbg forecasts stored');
  };
}
