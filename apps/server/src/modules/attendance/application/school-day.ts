import { schema, type Tx } from '@absah/db';
import { and, gte, lte } from 'drizzle-orm';
import { addDays } from '../../../shared/school-date';
import { isSchoolDay } from '../domain/status-rules';
import { calendarKind, daysWithPeriods } from '../infrastructure/session-repo';

/** Whether a date is a school day for the current school (calendar exceptions, then the timetable). */
export async function schoolDayOf(tx: Tx, date: string): Promise<{ schoolDay: boolean; reason: 'holiday' | 'not_school_day' | null }> {
  return isSchoolDay({ date, calendarKind: await calendarKind(tx, date), daysWithPeriods: await daysWithPeriods(tx) });
}

/** The school days from `from` to `to` (inclusive, YYYY-MM-DD), the same rule as schoolDayOf but with two queries for the whole range. */
export async function schoolDaysBetween(tx: Tx, from: string, to: string): Promise<string[]> {
  if (to < from) return [];
  const exceptions = new Map((await tx.select({ date: schema.calendarDays.date, kind: schema.calendarDays.kind }).from(schema.calendarDays).where(and(gte(schema.calendarDays.date, from), lte(schema.calendarDays.date, to)))).map((r) => [r.date, r.kind]));
  const withPeriods = await daysWithPeriods(tx);
  const days: string[] = [];
  for (let date = from; date <= to; date = addDays(date, 1)) {
    if (isSchoolDay({ date, calendarKind: exceptions.get(date) ?? null, daysWithPeriods: withPeriods }).schoolDay) days.push(date);
  }
  return days;
}
