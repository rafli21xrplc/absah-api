import type { MbgForecast } from '@absah/contracts';
import type { Logger } from 'pino';
import { authorize } from '../../../shared/authorize';
import { readCapabilityRows, resolveFromRows } from '../../../shared/capability';
import { withPlatform, withTenant } from '../../../shared/db';
import { emit } from '../../../shared/outbox';
import type { Actor } from '../../../shared/policy';
import { addDays, schoolDate, schoolMinutes } from '../../../shared/school-date';
import { schoolDayOf } from '../../attendance';
import { canReadMbg } from '../domain/policies';
import { forecastInputs, forecastsOf, insertForecasts, lockMbgDay, mbgJobSchools, mbgSettingsOf, schoolTimezone, type MbgJobSchool } from '../infrastructure/mbg-repo';

/** RKP-09: computed at 13.00 school time for the date three calendar days later. */
export const FORECAST_AT = 13 * 60;
export const FORECAST_DAYS_AHEAD = 3;

/**
 * One school's H-3 forecast: with mbg.enabled, from 13.00, when the target is a school day and has
 * no forecast yet. Stored per rombel; the PIC gets one message when a number is set.
 */
export function forecastForSchool(school: MbgJobSchool, now: Date): Promise<{ schoolDate: string; classes: number } | null> {
  return withTenant({ schoolId: school.id, userId: null }, async (tx) => {
    if (schoolMinutes(school.timezone, now) < FORECAST_AT) return null;
    const target = addDays(schoolDate(school.timezone, now), FORECAST_DAYS_AHEAD);
    if (!resolveFromRows(school, await readCapabilityRows(tx), target)['mbg.enabled']) return null;
    if (!(await schoolDayOf(tx, target)).schoolDay) return null;
    await lockMbgDay(tx, school.id, `forecast:${target}`);
    if ((await forecastsOf(tx, target)).length > 0) return null;
    const rows = await forecastInputs(tx, target);
    if (rows.length === 0) return null;
    const send = Boolean((await mbgSettingsOf(tx))?.picPhone);
    await insertForecasts(
      tx,
      rows.map((r) => ({ schoolId: school.id, classId: r.classId, schoolDate: target, enrolled: r.enrolled, onLeave: r.onLeave, offCampus: r.offCampus, forecast: r.enrolled - r.onLeave - r.offCampus, sentAt: send ? now : null })),
    );
    if (send) await emit(tx, 'mbg.forecast_ready', { schoolDate: target });
    return { schoolDate: target, classes: rows.length };
  });
}

/** Job rkp.mbg-forecast: every 5 minutes, each school on its own clock. */
export async function forecastDue(now = new Date(), logger?: Logger): Promise<number> {
  const schools = await withPlatform(mbgJobSchools);
  let done = 0;
  for (const school of schools) {
    try {
      if (await forecastForSchool(school, now)) done += 1;
    } catch (err) {
      logger?.error({ err, schoolId: school.id }, 'mbg forecast failed for school');
    }
  }
  return done;
}

/** GET /mbg/forecast: the stored forecast of a date (default three days from today). */
export function mbgForecast(actor: Actor, date: string | undefined, now = new Date()): Promise<MbgForecast> {
  authorize(actor, canReadMbg);
  return withTenant({ schoolId: actor.schoolId, userId: actor.userId }, async (tx) => {
    const day = date ?? addDays(schoolDate(await schoolTimezone(tx, actor.schoolId), now), FORECAST_DAYS_AHEAD);
    const rows = await forecastsOf(tx, day);
    const classes = rows.map(({ classId, name, enrolled, onLeave, offCampus, forecast }) => ({ classId, name, enrolled, onLeave, offCampus, forecast }));
    return {
      date: day,
      status: rows.length > 0 ? 'computed' : 'pending',
      computedAt: rows[0]?.createdAt.toISOString() ?? null,
      sentAt: rows[0]?.sentAt?.toISOString() ?? null,
      total: classes.reduce((n, r) => n + r.forecast, 0),
      classes,
    };
  });
}
