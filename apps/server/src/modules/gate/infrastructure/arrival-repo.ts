import { schema, type Tx } from '@absah/db';
import { and, asc, eq, gte, lte } from 'drizzle-orm';

const e = schema.enrollments;
const g = schema.gateScans;

/** The active enrollment (this year) with name and rombel. */
export async function activeStudent(tx: Tx, enrollmentId: string) {
  const [row] = await tx
    .select({ enrollmentId: e.id, name: schema.students.name, className: schema.classes.name })
    .from(e)
    .innerJoin(schema.students, eq(schema.students.id, e.studentId))
    .innerJoin(schema.classes, eq(schema.classes.id, e.classId))
    .innerJoin(schema.academicYears, and(eq(schema.academicYears.id, e.academicYearId), eq(schema.academicYears.isActive, true)))
    .where(and(eq(e.id, enrollmentId), eq(e.status, 'active')));
  return row;
}

/** Every active student this year with today's accepted arrival, if any. */
export function studentsWithArrival(tx: Tx, schoolDate: string) {
  return tx
    .select({
      enrollmentId: e.id,
      name: schema.students.name,
      className: schema.classes.name,
      arrivedAt: g.scannedAt,
      outcome: g.outcome,
      method: g.method,
      reason: g.reason,
    })
    .from(e)
    .innerJoin(schema.students, eq(schema.students.id, e.studentId))
    .innerJoin(schema.classes, eq(schema.classes.id, e.classId))
    .innerJoin(schema.academicYears, and(eq(schema.academicYears.id, e.academicYearId), eq(schema.academicYears.isActive, true)))
    .leftJoin(g, and(eq(g.enrollmentId, e.id), eq(g.schoolDate, schoolDate), eq(g.result, 'accepted')))
    .where(eq(e.status, 'active'))
    .orderBy(asc(schema.classes.name), asc(schema.students.name));
}

/**
 * Approved izin covering the date, by enrollment. Read from the leave table so the piket list does
 * not chase excused students (the gate screen only reads it).
 */
export async function excusedOn(tx: Tx, schoolDate: string): Promise<Map<string, 'S' | 'I'>> {
  const l = schema.leaveRequests;
  const rows = await tx
    .select({ enrollmentId: l.enrollmentId, kind: l.kind })
    .from(l)
    .where(and(eq(l.status, 'approved'), lte(l.startsOn, schoolDate), gte(l.endsOn, schoolDate)));
  return new Map(rows.map((r) => [r.enrollmentId, r.kind === 'sakit' ? 'S' : 'I']));
}
