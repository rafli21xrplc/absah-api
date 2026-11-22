import type { TeacherAttendance, TeacherToday } from '@absah/contracts';
import { uuidv7 } from 'uuidv7';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { schoolDayOf, schoolStartTime } from '../../attendance';
import { canCheckInAsTeacher } from '../domain/policies';
import { isLate } from '../domain/lateness';
import { findAttendance, insertCheckIn, setCheckOut } from '../infrastructure/attendance-repo';

/** The school's clock at the moment of the request, worked out by the caller from the school's timezone. */
export interface SchoolClock {
  now: Date;
  /** YYYY-MM-DD on the school's clock. */
  date: string;
  /** Minutes since the school's midnight. */
  minutes: number;
}

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });

type Row = NonNullable<Awaited<ReturnType<typeof findAttendance>>>;
const view = (r: Row): TeacherAttendance => ({
  schoolDate: r.schoolDate,
  checkedInAt: r.checkedInAt.toISOString(),
  checkedOutAt: r.checkedOutAt?.toISOString() ?? null,
  late: r.late,
  source: r.source,
});

/** GET /teacher-attendance/today: the caller's own day. */
export function teacherToday(actor: Actor, clock: SchoolClock): Promise<TeacherToday> {
  authorize(actor, canCheckInAsTeacher);
  return withTenant(scope(actor), async (tx) => {
    const day = await schoolDayOf(tx, clock.date);
    const row = await findAttendance(tx, actor.userId, clock.date);
    return { schoolDate: clock.date, schoolDay: day.schoolDay, schoolStart: await schoolStartTime(tx, clock.date), attendance: row ? view(row) : null };
  });
}

/**
 * POST /teacher-attendance/check-in: the first check-in of a school day is the record; sending it again returns
 * the same record, so a retry after a bad signal is safe. Only on a school day.
 */
export function checkIn(actor: Actor, clock: SchoolClock): Promise<{ attendance: TeacherAttendance; created: boolean }> {
  authorize(actor, canCheckInAsTeacher);
  return withTenant(scope(actor), async (tx) => {
    const existing = await findAttendance(tx, actor.userId, clock.date);
    if (existing) return { attendance: view(existing), created: false };
    if (!(await schoolDayOf(tx, clock.date)).schoolDay) throw new ConflictError('Hari ini bukan hari sekolah.', { reason: 'not_school_day' });
    const late = isLate(clock.minutes, await schoolStartTime(tx, clock.date));
    await insertCheckIn(tx, { id: uuidv7(), schoolId: actor.schoolId, userId: actor.userId, schoolDate: clock.date, checkedInAt: clock.now, late, source: 'app' });
    const row = await findAttendance(tx, actor.userId, clock.date);
    return { attendance: view(row as Row), created: true };
  });
}

/** POST /teacher-attendance/check-out: needs today's check-in; the latest check-out wins (a teacher who stays on). */
export function checkOut(actor: Actor, clock: SchoolClock): Promise<TeacherAttendance> {
  authorize(actor, canCheckInAsTeacher);
  return withTenant(scope(actor), async (tx) => {
    const existing = await findAttendance(tx, actor.userId, clock.date);
    if (!existing) throw new ConflictError('Absen masuk dulu sebelum absen pulang.', { reason: 'not_checked_in' });
    const at = clock.now < existing.checkedInAt ? existing.checkedInAt : clock.now;
    await setCheckOut(tx, existing.id, at);
    return view({ ...existing, checkedOutAt: at });
  });
}
