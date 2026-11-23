import type { SlotOwnerType } from '@absah/contracts';
import { schema, type Tx } from '@absah/db';
import { and, asc, eq, inArray, or, sql, type SQL } from 'drizzle-orm';
import { directoryName } from '../../../shared/directory-name';

export async function lockSchedule(tx: Tx, schoolId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`schedule:${schoolId}`}, 0))`);
}

export const listSubjects = (tx: Tx) =>
  tx.select({ id: schema.subjects.id, name: schema.subjects.name, code: schema.subjects.code }).from(schema.subjects).orderBy(asc(schema.subjects.name));

export async function findSubject(tx: Tx, id: string) {
  const [row] = await tx.select().from(schema.subjects).where(eq(schema.subjects.id, id));
  return row;
}

export async function insertSubjects(tx: Tx, schoolId: string, values: { name: string; code?: string | null }[]) {
  if (values.length === 0) return [];
  return tx
    .insert(schema.subjects)
    .values(values.map((v) => ({ schoolId, name: v.name, code: v.code ?? null })))
    .returning({ id: schema.subjects.id, name: schema.subjects.name, code: schema.subjects.code });
}

export async function readPeriods(tx: Tx) {
  const p = schema.schedulePeriods;
  const rows = await tx.select().from(p).orderBy(asc(p.day), asc(p.number));
  return rows.map((r) => ({ day: r.day, number: r.number, startsAt: r.startsAt.slice(0, 5), endsAt: r.endsAt.slice(0, 5) }));
}

export async function replacePeriods(tx: Tx, schoolId: string, rows: { day: number; number: number; startsAt: string; endsAt: string }[]) {
  await tx.delete(schema.schedulePeriods);
  if (rows.length > 0) await tx.insert(schema.schedulePeriods).values(rows.map((r) => ({ schoolId, ...r })));
}

/** Staff of the school who can teach or be wali kelas (via the member directory view). */
export async function listTeachers(tx: Tx): Promise<{ id: string; name: string }[]> {
  const result = await tx.execute(sql`
    select distinct on (user_id) user_id as id, name from school_member_directory
    where status = 'active' and role not in ('orang_tua', 'siswa', 'pembimbing_industri')
    order by user_id`);
  return (result.rows as { id: string; name: string }[]).sort((a, b) => a.name.localeCompare(b.name, 'id'));
}

export async function findClassInYear(tx: Tx, id: string, academicYearId: string) {
  const c = schema.classes;
  const [row] = await tx.select().from(c).where(and(eq(c.id, id), eq(c.academicYearId, academicYearId)));
  return row;
}

export async function findGroupInYear(tx: Tx, id: string, academicYearId: string) {
  const g = schema.learningGroups;
  const [row] = await tx.select().from(g).where(and(eq(g.id, id), eq(g.academicYearId, academicYearId)));
  return row;
}

export interface SlotFilter {
  ids?: string[];
  owner?: { ownerType: SlotOwnerType; ownerId: string };
  teacherId?: string;
  at?: { day: number; period: number }[];
}

/** Slots of a year with subject, teacher and owner names. */
export async function listSlots(tx: Tx, academicYearId: string, filter: SlotFilter = {}) {
  const s = schema.scheduleSlots;
  const where: SQL[] = [eq(s.academicYearId, academicYearId)];
  if (filter.ids) where.push(inArray(s.id, filter.ids.length ? filter.ids : ['00000000-0000-0000-0000-000000000000']));
  if (filter.owner) where.push(eq(s.ownerType, filter.owner.ownerType), eq(s.ownerId, filter.owner.ownerId));
  if (filter.teacherId) where.push(eq(s.teacherId, filter.teacherId));
  if (filter.at) {
    const times = or(...filter.at.map((t) => and(eq(s.day, t.day), eq(s.period, t.period))));
    if (times) where.push(times);
  }
  return tx
    .select({
      id: s.id,
      ownerType: s.ownerType,
      ownerId: s.ownerId,
      ownerName: sql<string>`coalesce(${schema.classes.name}, ${schema.learningGroups.name}, '')`,
      day: s.day,
      period: s.period,
      subjectId: s.subjectId,
      subjectName: schema.subjects.name,
      teacherId: s.teacherId,
      teacherName: directoryName(s.teacherId),
    })
    .from(s)
    .innerJoin(schema.subjects, eq(schema.subjects.id, s.subjectId))
    .leftJoin(schema.classes, and(eq(s.ownerType, 'class'), eq(schema.classes.id, s.ownerId)))
    .leftJoin(schema.learningGroups, and(eq(s.ownerType, 'group'), eq(schema.learningGroups.id, s.ownerId)))
    .where(and(...where))
    .orderBy(asc(s.day), asc(s.period));
}
export type SlotRow = Awaited<ReturnType<typeof listSlots>>[number];

export const ownerKey = (o: { ownerType: string; ownerId: string }) => `${o.ownerType}:${o.ownerId}`;

/** Students (ids) of rombel and groups: active enrollments of the year, group members likewise. */
export async function studentsOfOwners(
  tx: Tx,
  academicYearId: string,
  owners: { ownerType: SlotOwnerType; ownerId: string }[],
): Promise<Map<string, Set<string>>> {
  const e = schema.enrollments;
  const result = new Map<string, Set<string>>();
  const add = (key: string, student: string) => result.set(key, (result.get(key) ?? new Set()).add(student));
  const classIds = [...new Set(owners.filter((o) => o.ownerType === 'class').map((o) => o.ownerId))];
  const groupIds = [...new Set(owners.filter((o) => o.ownerType === 'group').map((o) => o.ownerId))];
  if (classIds.length) {
    const rows = await tx
      .select({ classId: e.classId, studentId: e.studentId })
      .from(e)
      .where(and(inArray(e.classId, classIds), eq(e.academicYearId, academicYearId), eq(e.status, 'active')));
    for (const r of rows) add(`class:${r.classId}`, r.studentId);
  }
  if (groupIds.length) {
    const m = schema.learningGroupMembers;
    const rows = await tx
      .select({ groupId: m.learningGroupId, studentId: e.studentId })
      .from(m)
      .innerJoin(e, eq(e.id, m.enrollmentId))
      .where(and(inArray(m.learningGroupId, groupIds), eq(e.status, 'active')));
    for (const r of rows) add(`group:${r.groupId}`, r.studentId);
  }
  return result;
}

export async function studentNames(tx: Tx, ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const rows = await tx.select({ name: schema.students.name }).from(schema.students).where(inArray(schema.students.id, ids)).orderBy(asc(schema.students.name));
  return rows.map((r) => r.name);
}

export async function upsertSlot(
  tx: Tx,
  values: { schoolId: string; academicYearId: string; ownerType: SlotOwnerType; ownerId: string; day: number; period: number; subjectId: string; teacherId: string | null },
): Promise<string> {
  const s = schema.scheduleSlots;
  await tx.delete(s).where(and(eq(s.ownerType, values.ownerType), eq(s.ownerId, values.ownerId), eq(s.day, values.day), eq(s.period, values.period)));
  const [row] = await tx.insert(s).values(values).returning({ id: s.id });
  if (!row) throw new Error('insert schedule_slots returned nothing');
  return row.id;
}

export async function deleteSlot(tx: Tx, id: string): Promise<boolean> {
  const rows = await tx.delete(schema.scheduleSlots).where(eq(schema.scheduleSlots.id, id)).returning({ id: schema.scheduleSlots.id });
  return rows.length > 0;
}

/** Slots at times that are not in the given set of (day, period). */
export async function countSlotsOutside(tx: Tx, keep: Set<string>): Promise<number> {
  const s = schema.scheduleSlots;
  const rows = await tx.select({ day: s.day, period: s.period }).from(s);
  return rows.filter((r) => !keep.has(`${r.day}:${r.period}`)).length;
}

export async function setHomeroomTeacher(tx: Tx, classId: string, teacherId: string | null): Promise<void> {
  await tx.update(schema.classes).set({ homeroomTeacherId: teacherId }).where(eq(schema.classes.id, classId));
}

/** Removes every lesson of the given rombel/groups in a year. */
export async function deleteOwnerSlots(tx: Tx, academicYearId: string, ownerType: SlotOwnerType, ownerIds: string[]): Promise<number> {
  if (ownerIds.length === 0) return 0;
  const s = schema.scheduleSlots;
  const rows = await tx
    .delete(s)
    .where(and(eq(s.academicYearId, academicYearId), eq(s.ownerType, ownerType), inArray(s.ownerId, ownerIds)))
    .returning({ id: s.id });
  return rows.length;
}

export async function insertSlots(tx: Tx, rows: (typeof schema.scheduleSlots.$inferInsert)[]): Promise<void> {
  if (rows.length > 0) await tx.insert(schema.scheduleSlots).values(rows);
}
