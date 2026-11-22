import type { EarlyWarning, EarlyWarningList, EarlyWarningsQuery } from '@absah/contracts';
import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { uuidv7 } from 'uuidv7';
import { authorize } from '../../../shared/authorize';
import { loadCapabilities, type SchoolProfile } from '../../../shared/capability';
import { withPlatform, withTenant } from '../../../shared/db';
import { emit } from '../../../shared/outbox';
import type { Actor } from '../../../shared/policy';
import { addDays, schoolDate, schoolMinutes } from '../../../shared/school-date';
import { canReadEarlyWarnings, canSeeAllFollowups } from '../domain/policies';
import { DEFAULT_RULES, EARLY_WARNING_AT, WARNING_COOLDOWN_DAYS, detectPatterns, withoutRecent, type StudentWindow } from '../domain/patterns';
import { bolosRows, dailyRows, insertWarning, listWarnings, markRun, pklAbsenceRows, recentWarnings, type WarningRow } from '../infrastructure/early-warning-repo';
import type { EarlyWarningKind } from '@absah/contracts';

/** Rows of the look-back: two calendar weeks cover the last 7 school days even across a weekend and a holiday. */
const LOOKBACK_DAYS = 14;

type JobSchool = SchoolProfile & { id: string };

/**
 * Job ksw.early-warning (every 5 minutes, each school's clock): from 18.00 the school's day is looked at once
 * (early_warning_runs marks it). The patterns searched follow the capabilities: bolos jam when attendance is per
 * jam pelajaran, PKL absence when PKL is on; consecutive alpa and repeated late always. A kind already warned
 * about within the cooldown is skipped. Each new warning emits ksw.early_warning_raised (push to wali kelas and BK).
 * A failed school is logged and retried on the next tick: the marker is written in the same transaction.
 */
export async function raiseEarlyWarnings(now = new Date(), logger?: Logger): Promise<number> {
  const schools = await withPlatform(async (tx) => {
    const res = await tx.execute<{ id: string; timezone: string; level: JobSchool['level']; is_madrasah: boolean }>(sql`select id, timezone, level, is_madrasah from schools order by id`);
    return res.rows.map((s): JobSchool => ({ id: s.id, timezone: s.timezone, level: s.level, isMadrasah: s.is_madrasah }));
  });
  let raised = 0;
  for (const school of schools) {
    try {
      if (schoolMinutes(school.timezone, now) < EARLY_WARNING_AT) continue;
      const caps = await loadCapabilities({ schoolId: school.id, userId: null }, school, logger);
      if (!caps['student.early_warning']) continue;
      raised += await warnSchool(school, schoolDate(school.timezone, now), { bolosJam: caps['attendance.mode'] === 'per_period', pkl: caps['pkl.enabled'] });
    } catch (err) {
      logger?.error({ err, schoolId: school.id }, 'early-warning failed for school');
    }
  }
  return raised;
}

async function warnSchool(school: JobSchool, today: string, focus: { bolosJam: boolean; pkl: boolean }): Promise<number> {
  return withTenant({ schoolId: school.id, userId: null }, async (tx) => {
    if (!(await markRun(tx, school.id, today))) return 0;
    const from = addDays(today, -LOOKBACK_DAYS);
    // One after the other: a transaction has one connection.
    const daily = await dailyRows(tx, from, today);
    const bolos = focus.bolosJam ? await bolosRows(tx, from, today) : [];
    const pkl = focus.pkl ? await pklAbsenceRows(tx, from, today) : [];
    const recent = await recentWarnings(tx, addDays(today, -WARNING_COOLDOWN_DAYS));
    const windows = new Map<string, StudentWindow>();
    const of = (id: string) => {
      let w = windows.get(id);
      if (!w) windows.set(id, (w = { daily: [], bolosDates: [], pklAbsentDates: [] }));
      return w;
    };
    for (const row of daily) of(row.enrollmentId).daily.push({ date: row.date, status: row.status });
    for (const row of bolos) of(row.enrollmentId).bolosDates.push(row.date);
    for (const row of pkl) of(row.enrollmentId).pklAbsentDates.push(row.date);
    const warned = new Map<string, Set<EarlyWarningKind>>();
    for (const row of recent) warned.set(row.enrollmentId, (warned.get(row.enrollmentId) ?? new Set()).add(row.kind));

    let made = 0;
    for (const [enrollmentId, window] of windows) {
      const patterns = withoutRecent(detectPatterns(window, today, { ...DEFAULT_RULES, focus }), warned.get(enrollmentId) ?? new Set());
      for (const p of patterns) {
        const id = uuidv7();
        if (!(await insertWarning(tx, { id, schoolId: school.id, enrollmentId, kind: p.kind, schoolDate: today, dates: p.dates }))) continue;
        await emit(tx, 'ksw.early_warning_raised', { warningId: id });
        made += 1;
      }
    }
    return made;
  });
}

const view = (r: WarningRow): EarlyWarning => ({
  id: r.id,
  student: { enrollmentId: r.enrollmentId, name: r.name, className: r.className },
  kind: r.kind,
  date: r.schoolDate,
  dates: [...r.dates].sort(),
});

/** GET /early-warnings: leaders and BK see all; a wali kelas the warnings of their class. */
export function listEarlyWarnings(actor: Actor, today: string, query: EarlyWarningsQuery): Promise<EarlyWarningList> {
  authorize(actor, canReadEarlyWarnings);
  const from = addDays(today, -(query.days ?? 14));
  return withTenant({ schoolId: actor.schoolId, userId: actor.userId }, async (tx) => {
    const rows = await listWarnings(tx, { from, homeroomTeacherId: canSeeAllFollowups.allows(actor) ? undefined : actor.userId });
    return { items: rows.map(view) };
  });
}
