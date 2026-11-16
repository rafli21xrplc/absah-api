import { schema, type Tx } from '@absah/db';
import { and, asc, desc, eq, exists, gte, sql } from 'drizzle-orm';

const st = schema.students;
const e = schema.enrollments;

/** Students the user is (siswa) or guards (orang_tua), with their active-year enrollment. */
export function portalStudents(tx: Tx, userId: string, as: 'student' | 'parent') {
  const mine =
    as === 'student'
      ? eq(st.userId, userId)
      : exists(
          tx
            .select({ one: sql`1` })
            .from(schema.studentGuardians)
            .innerJoin(schema.guardians, eq(schema.guardians.id, schema.studentGuardians.guardianId))
            .where(and(eq(schema.studentGuardians.studentId, st.id), eq(schema.guardians.userId, userId))),
        );
  return tx
    .select({ studentId: st.id, name: st.name, enrollmentId: e.id, className: schema.classes.name })
    .from(st)
    .innerJoin(e, eq(e.studentId, st.id))
    .innerJoin(schema.academicYears, and(eq(schema.academicYears.id, e.academicYearId), eq(schema.academicYears.isActive, true)))
    .innerJoin(schema.classes, eq(schema.classes.id, e.classId))
    .where(mine)
    .orderBy(asc(st.name));
}

export function dailyHistory(tx: Tx, enrollmentId: string, since: string) {
  const d = schema.dailyAttendance;
  return tx
    .select({ date: d.schoolDate, status: d.status })
    .from(d)
    .where(and(eq(d.enrollmentId, enrollmentId), gte(d.schoolDate, since)))
    .orderBy(desc(d.schoolDate));
}
