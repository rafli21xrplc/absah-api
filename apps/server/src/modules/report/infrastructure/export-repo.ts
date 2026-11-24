import type { ClassStream } from '@absah/contracts';
import { schema, type Tx } from '@absah/db';
import { and, asc, desc, eq, gte, inArray, isNull, lte, or, sql } from 'drizzle-orm';

const j = schema.exportJobs;
const sem = schema.semesters;
const y = schema.academicYears;
const c = schema.classes;
const e = schema.enrollments;
const d = schema.dailyAttendance;

export async function findSemester(tx: Tx, id: string) {
  const [row] = await tx
    .select({ id: sem.id, number: sem.number, startsOn: sem.startsOn, endsOn: sem.endsOn, academicYearId: y.id, academicYear: y.name })
    .from(sem)
    .innerJoin(y, eq(y.id, sem.academicYearId))
    .where(eq(sem.id, id));
  return row ?? null;
}

export async function findClassOfYear(tx: Tx, id: string, academicYearId: string) {
  const [row] = await tx
    .select({ id: c.id, name: c.name, homeroomId: c.homeroomTeacherId })
    .from(c)
    .where(and(eq(c.id, id), eq(c.academicYearId, academicYearId)));
  return row ?? null;
}

const jobView = {
  id: j.id,
  target: j.target,
  format: j.format,
  status: j.status,
  fileKey: j.fileKey,
  fileName: j.fileName,
  error: j.error,
  requestedBy: j.requestedBy,
  createdAt: j.createdAt,
  finishedAt: j.finishedAt,
  semesterId: sem.id,
  semesterNumber: sem.number,
  academicYear: y.name,
  classId: c.id,
  className: c.name,
  stream: j.stream,
};

function jobs(tx: Tx) {
  return tx.select(jobView).from(j).innerJoin(sem, eq(sem.id, j.semesterId)).innerJoin(y, eq(y.id, sem.academicYearId)).leftJoin(c, eq(c.id, j.classId));
}
export type ExportJobRow = Awaited<ReturnType<typeof listJobs>>[number];

export function listJobs(tx: Tx, requestedBy: string, limit = 20) {
  return jobs(tx).where(eq(j.requestedBy, requestedBy)).orderBy(desc(j.createdAt)).limit(limit);
}

export async function findJob(tx: Tx, id: string, lock = false) {
  const query = jobs(tx).where(eq(j.id, id));
  const [row] = lock ? await query.for('update', { of: j }) : await query;
  return row ?? null;
}

export function insertJob(tx: Tx, values: typeof j.$inferInsert) {
  return tx.insert(j).values(values);
}

export function finishJob(tx: Tx, id: string, result: { status: 'done'; fileName: string } | { status: 'failed'; error: string }) {
  return tx
    .update(j)
    .set({ ...result, finishedAt: new Date() })
    .where(eq(j.id, id));
}

export async function schoolInfo(tx: Tx, schoolId: string) {
  const [row] = await tx.select({ name: schema.schools.name, npsn: schema.schools.npsn, timezone: schema.schools.timezone, isMadrasah: schema.schools.isMadrasah }).from(schema.schools).where(eq(schema.schools.id, schoolId));
  return row ?? null;
}

export async function principalName(tx: Tx): Promise<string | null> {
  const result = await tx.execute(sql`select name from school_member_directory where role = 'kepsek' and status = 'active' order by name limit 1`);
  return (result.rows as { name: string }[])[0]?.name ?? null;
}

export function classesOfYear(tx: Tx, academicYearId: string, classId: string | null, stream: ClassStream | null = null) {
  return tx
    .select({ id: c.id, name: c.name, grade: c.grade, homeroomName: sql<string | null>`(select m.name from school_member_directory m where m.user_id = ${c.homeroomTeacherId} limit 1)` })
    .from(c)
    .where(and(eq(c.academicYearId, academicYearId), classId ? eq(c.id, classId) : undefined, stream ? eq(c.stream, stream) : undefined))
    .orderBy(asc(c.grade), asc(c.name));
}

const days = (status: string) => sql<number>`count(${d.schoolDate}) filter (where ${d.status} = ${status})::int`;

/** Every enrollment of the year that overlaps the semester, with its rekap days inside it. */
export function enrollmentDays(tx: Tx, academicYearId: string, from: string, to: string, studentIds?: string[]) {
  const st = schema.students;
  return tx
    .select({
      enrollmentId: e.id,
      studentId: st.id,
      name: st.name,
      nisn: st.nisn,
      localId: st.localId,
      classId: e.classId,
      startsOn: e.startsOn,
      status: e.status,
      H: days('H'),
      T: days('T'),
      S: days('S'),
      I: days('I'),
      A: days('A'),
    })
    .from(e)
    .innerJoin(st, eq(st.id, e.studentId))
    .leftJoin(d, and(eq(d.enrollmentId, e.id), gte(d.schoolDate, from), lte(d.schoolDate, to)))
    .where(
      and(
        eq(e.academicYearId, academicYearId),
        lte(e.startsOn, to),
        or(isNull(e.endsOn), gte(e.endsOn, from)),
        studentIds ? inArray(e.studentId, studentIds) : undefined,
      ),
    )
    .groupBy(e.id, st.id);
}

/** Students with an enrollment in the rombel during the semester (their other rombel count too). */
export async function studentsOfClass(tx: Tx, classId: string, from: string, to: string): Promise<string[]> {
  const rows = await tx
    .selectDistinct({ id: e.studentId })
    .from(e)
    .where(and(eq(e.classId, classId), lte(e.startsOn, to), or(isNull(e.endsOn), gte(e.endsOn, from))));
  return rows.map((r) => r.id);
}

/** Retention (withPlatform): finished files older than the cutoff, across schools. */
export function expireJobs(tx: Tx, cutoff: Date) {
  return tx
    .update(j)
    .set({ status: 'expired' })
    .where(and(eq(j.status, 'done'), lte(j.finishedAt, cutoff)))
    .returning({ fileKey: j.fileKey });
}
