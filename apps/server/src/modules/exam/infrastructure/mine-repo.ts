import { schema, type Tx } from '@absah/db';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';

const e = schema.enrollments;
const st = schema.students;

/** The user's own students' active enrollments in a year: the student themself, or the children of a parent. */
export function ownEnrollments(tx: Tx, userId: string, as: 'student' | 'parent', academicYearId: string) {
  const mine =
    as === 'student'
      ? eq(st.userId, userId)
      : sql`exists (select 1 from ${schema.studentGuardians} sg join ${schema.guardians} g on g.id = sg.guardian_id where sg.student_id = ${st.id} and g.user_id = ${userId})`;
  return tx
    .select({ enrollmentId: e.id, studentId: st.id, name: st.name, className: schema.classes.name })
    .from(e)
    .innerJoin(st, eq(st.id, e.studentId))
    .innerJoin(schema.classes, eq(schema.classes.id, e.classId))
    .where(and(eq(e.academicYearId, academicYearId), eq(e.status, 'active'), mine))
    .orderBy(asc(schema.classes.name), asc(st.name), asc(e.id));
}

/** Room name and seat of these enrollments in the period. */
export async function placesOf(tx: Tx, periodId: string, enrollmentIds: string[]) {
  if (enrollmentIds.length === 0) return new Map<string, { name: string; seatNo: number }>();
  const rows = await tx
    .select({ enrollmentId: schema.examSeats.enrollmentId, name: schema.examRooms.name, seatNo: schema.examSeats.seatNo })
    .from(schema.examSeats)
    .innerJoin(schema.examRooms, eq(schema.examRooms.id, schema.examSeats.roomId))
    .where(and(eq(schema.examSeats.periodId, periodId), inArray(schema.examSeats.enrollmentId, enrollmentIds)));
  return new Map(rows.map((r) => [r.enrollmentId, { name: r.name, seatNo: r.seatNo }]));
}
