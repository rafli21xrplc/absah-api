import { schema, type Tx } from '@absah/db';
import { and, asc, count, eq, inArray, sql } from 'drizzle-orm';

export async function listGroups(tx: Tx, academicYearId: string, id?: string) {
  const g = schema.learningGroups;
  const m = schema.learningGroupMembers;
  return tx
    .select({
      id: g.id,
      name: g.name,
      subjectId: g.subjectId,
      subjectName: schema.subjects.name,
      teacherId: g.teacherId,
      teacherName: sql<string | null>`(select d.name from school_member_directory d where d.user_id = ${g.teacherId} limit 1)`,
      memberCount: count(m.enrollmentId),
    })
    .from(g)
    .innerJoin(schema.subjects, eq(schema.subjects.id, g.subjectId))
    .leftJoin(m, eq(m.learningGroupId, g.id))
    .where(id ? and(eq(g.academicYearId, academicYearId), eq(g.id, id)) : eq(g.academicYearId, academicYearId))
    .groupBy(g.id, schema.subjects.name)
    .orderBy(asc(g.name));
}
export type GroupRow = Awaited<ReturnType<typeof listGroups>>[number];

export async function insertGroup(tx: Tx, values: typeof schema.learningGroups.$inferInsert): Promise<string> {
  const [row] = await tx.insert(schema.learningGroups).values(values).returning({ id: schema.learningGroups.id });
  if (!row) throw new Error('insert learning_groups returned nothing');
  return row.id;
}

export async function listMembers(tx: Tx, groupId: string) {
  const m = schema.learningGroupMembers;
  const e = schema.enrollments;
  return tx
    .select({ enrollmentId: m.enrollmentId, studentId: e.studentId, name: schema.students.name, className: schema.classes.name })
    .from(m)
    .innerJoin(e, eq(e.id, m.enrollmentId))
    .innerJoin(schema.students, eq(schema.students.id, e.studentId))
    .innerJoin(schema.classes, eq(schema.classes.id, e.classId))
    .where(eq(m.learningGroupId, groupId))
    .orderBy(asc(schema.students.name));
}

/** Active enrollments of the year among the given ids, with their student. */
export async function activeEnrollments(tx: Tx, academicYearId: string, ids: string[]) {
  if (ids.length === 0) return [];
  const e = schema.enrollments;
  return tx
    .select({ id: e.id, studentId: e.studentId })
    .from(e)
    .where(and(inArray(e.id, ids), eq(e.academicYearId, academicYearId), eq(e.status, 'active')));
}

export async function replaceMembers(tx: Tx, schoolId: string, groupId: string, enrollmentIds: string[]): Promise<void> {
  const m = schema.learningGroupMembers;
  await tx.delete(m).where(eq(m.learningGroupId, groupId));
  if (enrollmentIds.length > 0) await tx.insert(m).values(enrollmentIds.map((enrollmentId) => ({ schoolId, learningGroupId: groupId, enrollmentId })));
}
