import { schema, type Tx } from '@absah/db';
import { and, asc, count, eq, gt, ilike, isNotNull, or, sql, type SQL } from 'drizzle-orm';

export interface StudentPageQuery {
  academicYearId: string | null;
  q?: string;
  classId?: string;
  studentId?: string;
  status: 'active' | 'missing' | 'all';
  after?: { name: string; id: string };
  limit: number;
}

/** One page of students ordered by (name, id), with the active enrollment of the year. NIK never selected. */
export async function listStudentsPage(tx: Tx, query: StudentPageQuery) {
  const s = schema.students;
  const e = schema.enrollments;
  const c = schema.classes;
  const yearJoin = query.academicYearId
    ? and(eq(e.studentId, s.id), eq(e.status, 'active'), eq(e.academicYearId, query.academicYearId))
    : sql`false`;

  const where: SQL[] = [];
  if (query.status !== 'all') where.push(isNotNull(e.id));
  if (query.status === 'missing') where.push(isNotNull(e.missingSince));
  if (query.classId) where.push(eq(e.classId, query.classId));
  if (query.studentId) where.push(eq(s.id, query.studentId));
  if (query.q) {
    const term = query.q.replace(/[%_\\]/g, (m) => `\\${m}`);
    const match = or(ilike(s.name, `%${term}%`), ilike(s.nisn, `${term}%`), ilike(s.localId, `${term}%`));
    if (match) where.push(match);
  }
  if (query.after) {
    const after = or(gt(s.name, query.after.name), and(eq(s.name, query.after.name), gt(s.id, query.after.id)));
    if (after) where.push(after);
  }

  return tx
    .select({
      id: s.id,
      name: s.name,
      nisn: s.nisn,
      localId: s.localId,
      gender: s.gender,
      birthDate: s.birthDate,
      enrollmentId: e.id,
      classId: e.classId,
      className: c.name,
      enrollmentStatus: e.status,
      missingSince: e.missingSince,
    })
    .from(s)
    .leftJoin(e, yearJoin)
    .leftJoin(c, eq(c.id, e.classId))
    .where(and(...where))
    .orderBy(asc(s.name), asc(s.id))
    .limit(query.limit + 1);
}

/** Rombel of a year with counts and the homeroom teacher's name (via the member directory view). */
export async function listClassesWithCounts(tx: Tx, academicYearId: string) {
  const c = schema.classes;
  const e = schema.enrollments;
  return tx
    .select({
      id: c.id,
      name: c.name,
      grade: c.grade,
      stream: c.stream,
      homeroomTeacherId: c.homeroomTeacherId,
      homeroomTeacherName: sql<string | null>`(select d.name from school_member_directory d where d.user_id = ${c.homeroomTeacherId} limit 1)`,
      activeStudents: count(e.id),
      missingStudents: sql<number>`count(${e.id}) filter (where ${e.missingSince} is not null)`.mapWith(Number),
    })
    .from(c)
    .leftJoin(e, and(eq(e.classId, c.id), eq(e.status, 'active')))
    .where(eq(c.academicYearId, academicYearId))
    .groupBy(c.id)
    .orderBy(asc(c.grade), asc(c.name));
}

export async function lockEnrollment(tx: Tx, id: string) {
  const [row] = await tx.select().from(schema.enrollments).where(eq(schema.enrollments.id, id)).for('update');
  return row;
}
