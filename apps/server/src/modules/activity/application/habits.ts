import { HABIT_EDIT_DAYS, HABIT_RANGE_MAX_DAYS, KAIH_HABITS, type ClassHabitWeek, type ClassHabitsQuery, type HabitCode, type HabitDay, type HabitJournal, type HabitRangeQuery, type PutHabitsRequest } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { withPlatform, withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { addDays } from '../../../shared/school-date';
import { canSeeAllActivities } from '../domain/policies';
import { classOf, entriesOf, lockOldEntries, studentForHabits, upsertEntries, weekOfClass } from '../infrastructure/habit-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const NOT_FOUND = 'Siswa tidak ditemukan.';
export type HabitMode = 'parent' | 'student';

type Student = NonNullable<Awaited<ReturnType<typeof studentForHabits>>>;

/** Who ticks in this mode: the parent (SD) or the student themselves. */
const writes = (mode: HabitMode, s: Student) => (mode === 'parent' ? s.guardian : s.self);
/** The student, their parents, their wali kelas and the school's leaders read the journal. */
const reads = (actor: Actor, s: Student) => s.guardian || s.self || s.homeroom || canSeeAllActivities.allows(actor);

async function studentOrNotFound(tx: Tx, actor: Actor, studentId: string) {
  const s = await studentForHabits(tx, studentId, actor.userId);
  if (!s || !reads(actor, s)) throw new NotFoundError(NOT_FOUND);
  return s;
}

function days(rows: Awaited<ReturnType<typeof entriesOf>>, from: string, to: string, editableFrom: string): HabitDay[] {
  const out: HabitDay[] = [];
  for (let d = to; d >= from; d = addDays(d, -1)) {
    const of = rows.filter((r) => r.date === d);
    const habits = Object.fromEntries(KAIH_HABITS.map((h) => [h, of.find((r) => r.habit === h)?.value ?? null])) as Record<HabitCode, boolean | null>;
    const role = of[0]?.role;
    out.push({ date: d, habits, filledBy: role === 'orang_tua' || role === 'siswa' ? role : null, locked: d < editableFrom || of.some((r) => r.lockedAt !== null) });
  }
  return out;
}

/** GET /habits/{studentId}: the last 7 days by default, at most HABIT_RANGE_MAX_DAYS. */
export function habitJournal(actor: Actor, mode: HabitMode, today: string, studentId: string, query: HabitRangeQuery): Promise<HabitJournal> {
  const to = query.to ?? today;
  const from = query.from ?? addDays(to, -6);
  if (from > to || addDays(from, HABIT_RANGE_MAX_DAYS - 1) < to) throw new ValidationError([{ path: 'from', message: `Rentang paling panjang ${HABIT_RANGE_MAX_DAYS} hari.` }]);
  return withTenant(scope(actor), async (tx) => {
    const s = await studentOrNotFound(tx, actor, studentId);
    const editableFrom = addDays(today, -HABIT_EDIT_DAYS);
    const rows = s.enrollmentId ? await entriesOf(tx, s.enrollmentId, from, to) : [];
    return { studentId, name: s.name, mode, canEdit: writes(mode, s) && s.enrollmentId !== null, editableFrom, days: days(rows, from, to, editableFrom) };
  });
}

/**
 * PUT /habits/{studentId}/{date}: the parent (mode parent) or the student (mode student) ticks
 * habits of today or the HABIT_EDIT_DAYS before; older dates are locked (409 locked).
 */
export function putHabits(actor: Actor, mode: HabitMode, today: string, studentId: string, date: string, input: PutHabitsRequest): Promise<HabitDay> {
  return withTenant(scope(actor), async (tx) => {
    const s = await studentOrNotFound(tx, actor, studentId);
    if (!writes(mode, s) || !s.enrollmentId) {
      throw new ConflictError(mode === 'parent' ? 'Jurnal kebiasaan diisi orang tua.' : 'Jurnal kebiasaan diisi siswa sendiri.', { reason: 'not_filler', mode });
    }
    if (date > today) throw new ValidationError([{ path: 'date', message: 'Tanggal belum tiba.' }]);
    const editableFrom = addDays(today, -HABIT_EDIT_DAYS);
    if (date < editableFrom) throw new ConflictError('Jurnal tanggal ini sudah terkunci.', { reason: 'locked' });
    const existing = await entriesOf(tx, s.enrollmentId, date, date);
    if (existing.some((r) => r.lockedAt !== null)) throw new ConflictError('Jurnal tanggal ini sudah terkunci.', { reason: 'locked' });
    const role = mode === 'parent' ? 'orang_tua' : 'siswa';
    const enrollmentId = s.enrollmentId;
    const rows = KAIH_HABITS.flatMap((habit) => {
      const value = input.habits[habit];
      return value === undefined ? [] : [{ schoolId: actor.schoolId, enrollmentId, schoolDate: date, habit, value, filledBy: actor.userId, filledByRole: role } as const];
    });
    await upsertEntries(tx, rows);
    const [day] = days(await entriesOf(tx, enrollmentId, date, date), date, date, editableFrom);
    if (!day) throw new Error('habit day vanished');
    return day;
  });
}

/** The Monday of the week holding `date`. */
export function mondayOf(date: string): string {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return addDays(date, -((weekday + 6) % 7));
}

/** Weekly summary for the wali kelas of the rombel (or the school's leaders). */
export function classHabitWeek(actor: Actor, today: string, classId: string, query: ClassHabitsQuery): Promise<ClassHabitWeek> {
  const weekStart = mondayOf(query.weekStart ?? today);
  const weekEnd = addDays(weekStart, 6);
  return withTenant(scope(actor), async (tx) => {
    const cls = await classOf(tx, classId);
    if (!cls || !(cls.homeroomTeacherId === actor.userId || canSeeAllActivities.allows(actor))) throw new NotFoundError('Rombel tidak ditemukan.');
    const rows = await weekOfClass(tx, classId, weekStart, weekEnd);
    return {
      classId,
      className: cls.name,
      weekStart,
      weekEnd,
      students: rows.map((r) => ({
        studentId: r.studentId,
        name: r.name,
        daysFilled: r.daysFilled,
        counts: Object.fromEntries(KAIH_HABITS.map((h) => [h, r.ticks.find((t) => t.habit === h)?.n ?? 0])) as Record<HabitCode, number>,
      })),
    };
  });
}

/** keg.lock-habits (00.30): locks entries older than HABIT_EDIT_DAYS in every school. */
export function lockHabits(): Promise<number> {
  return withPlatform((tx) => lockOldEntries(tx, HABIT_EDIT_DAYS));
}

