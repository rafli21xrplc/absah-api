import type { Tx } from '@absah/db';
import { isSchoolDay } from '../domain/status-rules';
import { calendarKind, daysWithPeriods } from '../infrastructure/session-repo';

/** Whether a date is a school day for the current school (calendar exceptions, then the timetable). */
export async function schoolDayOf(tx: Tx, date: string): Promise<{ schoolDay: boolean; reason: 'holiday' | 'not_school_day' | null }> {
  return isSchoolDay({ date, calendarKind: await calendarKind(tx, date), daysWithPeriods: await daysWithPeriods(tx) });
}
