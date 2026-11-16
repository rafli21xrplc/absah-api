import type {
  CreateSubjectRequest,
  PutScheduleSlotRequest,
  ReplaceSchedulePeriodsRequest,
  ScheduleConflictDetail,
  ScheduleQuery,
  ScheduleResponse,
  SchedulePeriodsResponse,
  ScheduleSlot,
} from '@absah/contracts';
import type { Tx } from '@absah/db';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError, ScheduleConflictError, ValidationError } from '../../../shared/errors';
import { isUniqueViolation } from '../../../shared/pg-errors';
import type { Actor } from '../../../shared/policy';
import { canManageSchedule, canReadSchedule } from '../domain/policies';
import { findScheduleConflicts, validateDayPeriods, type ScheduleConflict, type TimedSlot } from '../domain/schedule-conflicts';
import {
  countSlotsOutside,
  deleteSlot,
  findClassInYear,
  findGroupInYear,
  findSubject,
  insertSubjects,
  listSlots,
  listSubjects,
  listTeachers,
  lockSchedule,
  ownerKey,
  readPeriods,
  replacePeriods,
  setHomeroomTeacher,
  studentNames,
  studentsOfOwners,
  upsertSlot,
  type SlotRow,
} from '../infrastructure/schedule-repo';
import { listClassesWithCounts } from '../infrastructure/registry-read-repo';
import { findActiveAcademicYear } from '../infrastructure/student-import-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });

export async function requireActiveYear(tx: Tx) {
  const year = await findActiveAcademicYear(tx);
  if (!year) throw new ConflictError('Belum ada tahun ajaran aktif. Import data siswa terlebih dahulu.');
  return year;
}

export function toSlot(r: SlotRow): ScheduleSlot {
  return {
    id: r.id,
    ownerType: r.ownerType,
    ownerId: r.ownerId,
    ownerName: r.ownerName,
    day: r.day,
    period: r.period,
    subject: { id: r.subjectId, name: r.subjectName },
    teacher: r.teacherId ? { id: r.teacherId, name: r.teacherName ?? '' } : null,
  };
}

export async function getSubjects(actor: Actor) {
  authorize(actor, canReadSchedule);
  return { items: await withTenant(scope(actor), listSubjects) };
}

export async function createSubject(actor: Actor, input: CreateSubjectRequest) {
  authorize(actor, canManageSchedule);
  try {
    const [row] = await withTenant(scope(actor), (tx) => insertSubjects(tx, actor.schoolId, [input]));
    if (!row) throw new Error('subject not created');
    return row;
  } catch (err) {
    if (isUniqueViolation(err, 'subjects_school_id_name_key')) throw new ConflictError('Mapel dengan nama ini sudah ada.');
    throw err;
  }
}

function groupDays(rows: { day: number; number: number; startsAt: string; endsAt: string }[]): SchedulePeriodsResponse {
  const days = new Map<number, { number: number; startsAt: string; endsAt: string }[]>();
  for (const { day, ...p } of rows) days.set(day, [...(days.get(day) ?? []), p]);
  return { days: [...days].map(([day, periods]) => ({ day, periods })) };
}

export async function getPeriods(actor: Actor): Promise<SchedulePeriodsResponse> {
  authorize(actor, canReadSchedule);
  return groupDays(await withTenant(scope(actor), readPeriods));
}

/** Replaces all jam pelajaran. Refused while lessons sit in a period that would disappear. */
export async function setPeriods(actor: Actor, input: ReplaceSchedulePeriodsRequest): Promise<SchedulePeriodsResponse> {
  authorize(actor, canManageSchedule);
  const issues = input.days.flatMap((d, i) => validateDayPeriods(d.periods).map((message) => ({ path: `days.${i}.periods`, message })));
  if (new Set(input.days.map((d) => d.day)).size !== input.days.length) issues.push({ path: 'days', message: 'Satu hari tercantum dua kali.' });
  if (issues.length) throw new ValidationError(issues);

  const rows = input.days.flatMap((d) => d.periods.map((p) => ({ day: d.day, ...p })));
  return withTenant(scope(actor), async (tx) => {
    await lockSchedule(tx, actor.schoolId);
    const orphaned = await countSlotsOutside(tx, new Set(rows.map((r) => `${r.day}:${r.number}`)));
    if (orphaned > 0) throw new ConflictError(`Masih ada ${orphaned} pelajaran di jam yang akan dihapus. Pindahkan dulu pelajarannya.`, { slots: orphaned });
    await replacePeriods(tx, actor.schoolId, rows);
    return groupDays(await readPeriods(tx));
  });
}

export async function getTeachers(actor: Actor) {
  authorize(actor, canManageSchedule);
  return { items: await withTenant(scope(actor), listTeachers) };
}

export async function getSchedule(actor: Actor, query: ScheduleQuery): Promise<ScheduleResponse> {
  authorize(actor, canReadSchedule);
  return withTenant(scope(actor), async (tx) => {
    const year = await findActiveAcademicYear(tx);
    if (!year) return { academicYear: null, slots: [] };
    const filter = query.classId
      ? { owner: { ownerType: 'class' as const, ownerId: query.classId } }
      : query.groupId
        ? { owner: { ownerType: 'group' as const, ownerId: query.groupId } }
        : { teacherId: query.teacherId };
    const rows = await listSlots(tx, year.id, filter);
    return { academicYear: { id: year.id, name: year.name }, slots: rows.map(toSlot) };
  });
}

/** Human-readable conflicts for a 409, from the point of view of the slots in `focus`. */
export async function describeConflicts(
  tx: Tx,
  conflicts: ScheduleConflict[],
  names: Map<string, { ownerName: string; teacherName: string | null }>,
  focus: Set<string>,
): Promise<ScheduleConflictDetail[]> {
  const details: ScheduleConflictDetail[] = [];
  for (const c of conflicts) {
    const other = focus.has(c.a.id) ? c.b : c.a;
    const students = c.kind === 'student' ? c.studentIds : [];
    details.push({
      kind: c.kind,
      day: other.day,
      period: other.period,
      with: names.get(other.id)?.ownerName ?? '',
      teacher: c.kind === 'teacher' ? (names.get(other.id)?.teacherName ?? null) : null,
      studentCount: students.length,
      students: await studentNames(tx, students.slice(0, 5)),
    });
  }
  return details;
}

export const CONFLICT_MESSAGE = 'Jadwal bentrok: guru atau siswa sudah punya pelajaran di jam tersebut.';

/** Teachers must be active staff of the school. */
export async function assertTeacher(tx: Tx, teacherId: string | null): Promise<void> {
  if (teacherId === null) return;
  if (!(await listTeachers(tx)).some((t) => t.id === teacherId)) {
    throw new ValidationError([{ path: 'teacherId', message: 'Guru tidak terdaftar sebagai staf aktif sekolah ini.' }]);
  }
}

export async function assertOwner(tx: Tx, owner: { ownerType: 'class' | 'group'; ownerId: string }, academicYearId: string) {
  const found = owner.ownerType === 'class' ? await findClassInYear(tx, owner.ownerId, academicYearId) : await findGroupInYear(tx, owner.ownerId, academicYearId);
  if (!found) throw new NotFoundError(owner.ownerType === 'class' ? 'Rombel tidak ditemukan di tahun ajaran aktif.' : 'Kelompok belajar tidak ditemukan.');
}

/**
 * Sets one lesson. Refused (409 SCHEDULE_CONFLICT) when the teacher, or any student of the rombel
 * or group, already has a lesson at that time. Replaces the owner's previous lesson at that time.
 */
export async function putSlot(actor: Actor, input: PutScheduleSlotRequest): Promise<ScheduleSlot> {
  authorize(actor, canManageSchedule);
  return withTenant(scope(actor), async (tx) => {
    await lockSchedule(tx, actor.schoolId);
    const year = await requireActiveYear(tx);
    await assertOwner(tx, input, year.id);
    if (!(await findSubject(tx, input.subjectId))) throw new ValidationError([{ path: 'subjectId', message: 'Mapel tidak ditemukan.' }]);
    await assertTeacher(tx, input.teacherId);
    const periods = await readPeriods(tx);
    if (!periods.some((p) => p.day === input.day && p.number === input.period)) {
      throw new ValidationError([{ path: 'period', message: 'Jam pelajaran ini belum diatur untuk hari tersebut.' }]);
    }

    const at = [{ day: input.day, period: input.period }];
    const others = (await listSlots(tx, year.id, { at })).filter((s) => ownerKey(s) !== ownerKey(input));
    const proposed: TimedSlot = { id: 'proposed', ...input };
    const students = await studentsOfOwners(tx, year.id, [input, ...others]);
    const conflicts = findScheduleConflicts([proposed, ...others], (o) => students.get(ownerKey(o)) ?? new Set()).filter(
      (c) => c.a.id === 'proposed' || c.b.id === 'proposed',
    );
    if (conflicts.length > 0) {
      const names = new Map(others.map((o) => [o.id, { ownerName: o.ownerName, teacherName: o.teacherName }]));
      throw new ScheduleConflictError(CONFLICT_MESSAGE, await describeConflicts(tx, conflicts, names, new Set(['proposed'])));
    }

    const id = await upsertSlot(tx, { schoolId: actor.schoolId, academicYearId: year.id, ...input });
    const [row] = await listSlots(tx, year.id, { ids: [id] });
    if (!row) throw new Error('slot vanished');
    return toSlot(row);
  });
}

export async function removeSlot(actor: Actor, slotId: string): Promise<void> {
  authorize(actor, canManageSchedule);
  const deleted = await withTenant(scope(actor), (tx) => deleteSlot(tx, slotId));
  if (!deleted) throw new NotFoundError('Pelajaran tidak ditemukan.');
}

/** Sets or clears the wali kelas of a rombel in the active year. */
export async function setHomeroom(actor: Actor, classId: string, teacherId: string | null) {
  authorize(actor, canManageSchedule);
  return withTenant(scope(actor), async (tx) => {
    const year = await requireActiveYear(tx);
    if (!(await findClassInYear(tx, classId, year.id))) throw new NotFoundError('Rombel tidak ditemukan di tahun ajaran aktif.');
    await assertTeacher(tx, teacherId);
    await setHomeroomTeacher(tx, classId, teacherId);
    const row = (await listClassesWithCounts(tx, year.id)).find((c) => c.id === classId);
    if (!row) throw new Error('class vanished');
    return {
      id: row.id,
      name: row.name,
      grade: row.grade,
      stream: row.stream,
      homeroomTeacher: row.homeroomTeacherId && row.homeroomTeacherName ? { id: row.homeroomTeacherId, name: row.homeroomTeacherName } : null,
      activeStudents: row.activeStudents,
      missingStudents: row.missingStudents,
    };
  });
}
