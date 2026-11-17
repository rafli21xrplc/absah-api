import type { SessionMode } from '@absah/contracts';

/** Local times (minutes after midnight, school timezone) that drive the attendance jobs. */
export const GENERATE_AT = 5 * 60; // 05.00
export const LOCK_AT = 23 * 60 + 59; // 23.59
/** A daily session (SD) not filled by 10.00 is reminded; lesson sessions 10 minutes after the lesson. */
export const DAILY_REMINDER_AT = 10 * 60;
export const REMINDER_DELAY_MINUTES = 10;

export interface PlannedSession {
  mode: SessionMode;
  ownerType: 'class' | 'group' | 'activity';
  ownerId: string;
  slotId: string | null;
  teacherId: string | null;
  activityId?: string | null;
}

export interface PlannableActivity {
  id: string;
  days: number[];
  startsOn: string | null;
  endsOn: string | null;
  active: boolean;
}

/**
 * Activity sessions of a date (KEG-01): active activities meeting on that weekday, inside their
 * date range. No teacher: every coach of the activity may fill it.
 */
export function planActivitySessions(activities: PlannableActivity[], date: string, weekday: number): PlannedSession[] {
  return activities
    .filter((a) => a.active && a.days.includes(weekday) && (!a.startsOn || a.startsOn <= date) && (!a.endsOn || date <= a.endsOn))
    .map((a) => activitySession(a.id));
}

export const activitySession = (activityId: string): PlannedSession => ({ mode: 'activity', ownerType: 'activity', ownerId: activityId, slotId: null, teacherId: null, activityId });

/**
 * The sessions of one school day. daily: one per rombel, owned by the wali kelas (PRS, SD/MI).
 * per_period: one per lesson of that weekday, rombel or learning group, owned by its teacher.
 */
export function planSessions(
  mode: 'daily' | 'per_period',
  day: { classes: { id: string; homeroomTeacherId: string | null }[]; slots: { id: string; ownerType: 'class' | 'group'; ownerId: string; teacherId: string | null }[] },
): PlannedSession[] {
  if (mode === 'daily') {
    return day.classes.map((c) => ({ mode: 'daily', ownerType: 'class', ownerId: c.id, slotId: null, teacherId: c.homeroomTeacherId }));
  }
  return day.slots.map((s) => ({ mode: 'per_period', ownerType: s.ownerType, ownerId: s.ownerId, slotId: s.id, teacherId: s.teacherId }));
}

const minutesOf = (time: string) => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));

/** When an open session should be reminded (local minutes), or null when it never is. */
export function reminderDueAt(session: { mode: SessionMode; periodEndsAt: string | null }): number | null {
  if (session.mode === 'daily') return DAILY_REMINDER_AT;
  if (session.mode === 'per_period' && session.periodEndsAt) return minutesOf(session.periodEndsAt) + REMINDER_DELAY_MINUTES;
  return null;
}

/** Whether the day `date` is due to be locked at local (today, minutes). Missed days are caught up. */
export function isLockDue(date: string, today: string, minutes: number): boolean {
  return date < today || (date === today && minutes >= LOCK_AT);
}
