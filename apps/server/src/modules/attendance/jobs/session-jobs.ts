import type { Logger } from 'pino';
import { readCapabilityRows, resolveFromRows } from '../../../shared/capability';
import { withPlatform, withTenant } from '../../../shared/db';
import { emit } from '../../../shared/outbox';
import { applyLeavesToDate } from '../application/leave-marks';
import { schoolDate, schoolMinutes } from '../../../shared/school-date';
import { GENERATE_AT, isLockDue, planSessions, reminderDueAt } from '../domain/session-plan';
import { isoWeekday, isSchoolDay } from '../domain/status-rules';
import {
  activeYearId,
  calendarKind,
  classesOfYear,
  daysWithPeriods,
  findDay,
  insertSessions,
  listSchools,
  lockAttendanceDay,
  lockSessions,
  markDay,
  markReminded,
  recomputeDaily,
  slotsOfDay,
  unlockedDays,
  unremindedSessions,
  type JobSchool,
} from '../infrastructure/session-repo';

/**
 * The three PRS jobs run every 5 minutes for all schools and act on each school's local clock
 * (docs/architecture.md "Job terjadwal": zona waktu per sekolah). Each step is idempotent, so a
 * late or repeated run only catches up.
 */
export const GENERATE_SESSIONS_QUEUE = 'prs.generate-sessions';
export const REMIND_UNFILLED_QUEUE = 'prs.remind-unfilled';
export const LOCK_SESSIONS_QUEUE = 'prs.lock-sessions';
export const ATTENDANCE_JOB_CRON = '*/5 * * * *';

type PerSchool<T> = { schoolId: string; result: T }[];

async function forEachSchool<T>(fn: (school: JobSchool) => Promise<T | null>, logger?: Logger): Promise<PerSchool<T>> {
  const schools = await withPlatform(listSchools);
  const results: PerSchool<T> = [];
  for (const school of schools) {
    try {
      const result = await fn(school);
      if (result !== null) results.push({ schoolId: school.id, result });
    } catch (err) {
      // One broken school must not stop the others.
      logger?.error({ err, schoolId: school.id }, 'attendance job failed for school');
    }
  }
  return results;
}

export type GenerateResult = { schoolDate: string; created: number } | { schoolDate: string; skipped: 'holiday' | 'not_school_day' };

/**
 * Sessions of one school date. Without force: once per date, only on school days. With force
 * (ops CLI): also on other days and again after a schedule change (existing sessions are kept).
 */
export function generateForSchool(school: JobSchool, date: string, now: Date, options: { force?: boolean } = {}): Promise<GenerateResult | null> {
  return withTenant({ schoolId: school.id, userId: null }, async (tx): Promise<GenerateResult | null> => {
    await lockAttendanceDay(tx, school.id, date);
    const day = await findDay(tx, date);
    if (!options.force && (day?.generatedAt || day?.skippedReason)) return null;
    const yearId = await activeYearId(tx);
    if (!yearId) return null; // nothing to take attendance for yet; checked again next run

    const check = isSchoolDay({ date, calendarKind: await calendarKind(tx, date), daysWithPeriods: await daysWithPeriods(tx) });
    if (!options.force && !check.schoolDay && check.reason) {
      await markDay(tx, school.id, date, { skippedReason: check.reason });
      return { schoolDate: date, skipped: check.reason };
    }
    const caps = resolveFromRows(school, await readCapabilityRows(tx), date);
    const mode = caps['attendance.mode'];
    const plan = planSessions(mode, { classes: await classesOfYear(tx, yearId), slots: mode === 'per_period' ? await slotsOfDay(tx, yearId, isoWeekday(date)) : [] });
    const created = await insertSessions(tx, school.id, date, plan);
    await applyLeavesToDate(tx, school.id, date);
    await markDay(tx, school.id, date, { generatedAt: now });
    return { schoolDate: date, created };
  });
}

/** From 05.00 local time: today's sessions per attendance.mode, unless it is not a school day. */
export function generateDueSessions(now = new Date(), logger?: Logger): Promise<PerSchool<GenerateResult>> {
  return forEachSchool(async (school) => {
    if (schoolMinutes(school.timezone, now) < GENERATE_AT) return null;
    return generateForSchool(school, schoolDate(school.timezone, now), now);
  }, logger);
}

/** Open sessions past their reminder time get one attendance.session_unfilled event each. */
export function remindUnfilled(now = new Date(), logger?: Logger): Promise<PerSchool<{ reminded: number }>> {
  return forEachSchool(async (school) => {
    const date = schoolDate(school.timezone, now);
    const minutes = schoolMinutes(school.timezone, now);
    return withTenant({ schoolId: school.id, userId: null }, async (tx) => {
      const due = (await unremindedSessions(tx, date)).filter((s) => {
        const at = reminderDueAt(s);
        return at !== null && at <= minutes;
      });
      for (const s of due) if (s.teacherId) await emit(tx, 'attendance.session_unfilled', { sessionId: s.id, teacherId: s.teacherId });
      await markReminded(tx, due.map((s) => s.id), now);
      return due.length ? { reminded: due.length } : null;
    });
  }, logger);
}

/**
 * At 23.59 local time (or later, catching up on missed runs): open sessions become missed, all are
 * locked, daily_attendance is computed, and attendance.session_locked is emitted once per day.
 */
export function lockDueDays(now = new Date(), logger?: Logger): Promise<PerSchool<{ schoolDate: string; sessions: number; missed: number }[]>> {
  return forEachSchool(async (school) => {
    const today = schoolDate(school.timezone, now);
    const minutes = schoolMinutes(school.timezone, now);
    return withTenant({ schoolId: school.id, userId: null }, async (tx) => {
      const locked = [];
      for (const { schoolDate: date } of await unlockedDays(tx)) {
        if (!isLockDue(date, today, minutes)) continue;
        await lockAttendanceDay(tx, school.id, date);
        const result = await lockSessions(tx, date, now);
        await recomputeDaily(tx, school.id, date);
        await markDay(tx, school.id, date, { lockedAt: now });
        if (result.sessions > 0) await emit(tx, 'attendance.session_locked', { schoolDate: date, ...result });
        locked.push({ schoolDate: date, ...result });
      }
      return locked.length ? locked : null;
    });
  }, logger);
}

export function attendanceJobHandlers(logger: Logger) {
  return {
    [GENERATE_SESSIONS_QUEUE]: async () => {
      logger.info({ queue: GENERATE_SESSIONS_QUEUE, schools: (await generateDueSessions(new Date(), logger)).length }, 'sessions generated');
    },
    [REMIND_UNFILLED_QUEUE]: async () => {
      const results = await remindUnfilled(new Date(), logger);
      if (results.length) logger.info({ queue: REMIND_UNFILLED_QUEUE, schools: results.length }, 'unfilled sessions reminded');
    },
    [LOCK_SESSIONS_QUEUE]: async () => {
      const results = await lockDueDays(new Date(), logger);
      if (results.length) logger.info({ queue: LOCK_SESSIONS_QUEUE, schools: results.length }, 'attendance days locked');
    },
  };
}
