import { schema, sensitive, type Tx } from '@absah/db';
import type { UksOutcome } from '@absah/contracts';
import { and, asc, desc, eq, ilike } from 'drizzle-orm';
import { directoryName } from '../../../shared/directory-name';

const u = schema.uksVisits;
const e = schema.enrollments;

const student = { enrollmentId: e.id, name: schema.students.name, className: schema.classes.name };

/** Active students whose name contains the text (LIKE wildcards escaped), at most 20. */
export function searchStudents(tx: Tx, text: string) {
  const term = text.replace(/[%_\\]/g, (m) => `\\${m}`);
  return tx
    .select(student)
    .from(e)
    .innerJoin(schema.students, eq(schema.students.id, e.studentId))
    .innerJoin(schema.classes, eq(schema.classes.id, e.classId))
    .where(and(eq(e.status, 'active'), ilike(schema.students.name, `%${term}%`)))
    .orderBy(asc(schema.students.name), asc(e.id))
    .limit(20);
}

export async function activeStudent(tx: Tx, enrollmentId: string) {
  const [row] = await tx
    .select(student)
    .from(e)
    .innerJoin(schema.students, eq(schema.students.id, e.studentId))
    .innerJoin(schema.classes, eq(schema.classes.id, e.classId))
    .where(and(eq(e.id, enrollmentId), eq(e.status, 'active')));
  return row;
}

export interface NewVisit {
  id: string;
  schoolId: string;
  enrollmentId: string;
  schoolDate: string;
  complaint: string;
  action: string | null;
  outcome: UksOutcome;
  recordedBy: string;
}

export async function insertVisit(tx: Tx, row: NewVisit): Promise<void> {
  await tx.insert(u).values({ ...row, complaint: sensitive(row.complaint), action: row.action === null ? null : sensitive(row.action) });
}

const recorder = directoryName(u.recordedBy);

const visitColumns = {
  id: u.id,
  schoolDate: u.schoolDate,
  visitedAt: u.visitedAt,
  ...student,
  complaint: u.complaint,
  action: u.action,
  outcome: u.outcome,
  recordedById: u.recordedBy,
  recordedByName: recorder,
};

function visits(tx: Tx) {
  return tx
    .select(visitColumns)
    .from(u)
    .innerJoin(e, eq(e.id, u.enrollmentId))
    .innerJoin(schema.students, eq(schema.students.id, e.studentId))
    .innerJoin(schema.classes, eq(schema.classes.id, e.classId));
}

export async function findVisit(tx: Tx, id: string) {
  const [row] = await visits(tx).where(eq(u.id, id));
  return row;
}

export const visitsOfDay = (tx: Tx, schoolDate: string) => visits(tx).where(eq(u.schoolDate, schoolDate)).orderBy(desc(u.visitedAt), desc(u.id));
export type VisitRow = NonNullable<Awaited<ReturnType<typeof findVisit>>>;
