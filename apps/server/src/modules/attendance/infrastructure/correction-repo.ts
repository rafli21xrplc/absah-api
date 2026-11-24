import type { AttendanceStatus, CorrectionStatus } from '@absah/contracts';
import { schema, type Tx } from '@absah/db';
import { and, desc, eq, inArray, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { directoryName } from '../../../shared/directory-name';

const c = schema.correctionRequests;
const s = schema.attendanceSessions;
const name = (column: AnyColumn) => directoryName(column);

export async function insertCorrections(
  tx: Tx,
  rows: { schoolId: string; sessionId: string; enrollmentId: string; fromStatus: AttendanceStatus | null; toStatus: AttendanceStatus; reason: string; requestedBy: string }[],
): Promise<string[]> {
  const inserted = await tx.insert(c).values(rows).returning({ id: c.id });
  return inserted.map((r) => r.id);
}

export async function listCorrections(tx: Tx, filter: { status?: CorrectionStatus; requestedBy?: string; ids?: string[]; id?: string }) {
  const where: SQL[] = [];
  if (filter.status) where.push(eq(c.status, filter.status));
  if (filter.requestedBy) where.push(eq(c.requestedBy, filter.requestedBy));
  if (filter.id) where.push(eq(c.id, filter.id));
  if (filter.ids) where.push(inArray(c.id, filter.ids));
  return tx
    .select({
      id: c.id,
      sessionId: s.id,
      schoolDate: s.schoolDate,
      ownerName: sql<string>`coalesce(${schema.classes.name}, ${schema.learningGroups.name}, ${schema.activities.name}, '')`,
      subject: schema.subjects.name,
      period: schema.scheduleSlots.period,
      enrollmentId: c.enrollmentId,
      studentName: schema.students.name,
      className: sql<string>`(select k.name from classes k join enrollments e on e.class_id = k.id where e.id = ${c.enrollmentId})`,
      fromStatus: c.fromStatus,
      toStatus: c.toStatus,
      reason: c.reason,
      status: c.status,
      requestedBy: c.requestedBy,
      requestedByName: name(c.requestedBy),
      decidedBy: c.decidedBy,
      decidedByName: name(c.decidedBy),
      decidedAt: c.decidedAt,
      decisionNote: c.decisionNote,
      createdAt: c.createdAt,
    })
    .from(c)
    .innerJoin(s, eq(s.id, c.sessionId))
    .innerJoin(schema.enrollments, eq(schema.enrollments.id, c.enrollmentId))
    .innerJoin(schema.students, eq(schema.students.id, schema.enrollments.studentId))
    .leftJoin(schema.classes, and(eq(s.ownerType, 'class'), eq(schema.classes.id, s.ownerId)))
    .leftJoin(schema.learningGroups, and(eq(s.ownerType, 'group'), eq(schema.learningGroups.id, s.ownerId)))
    .leftJoin(schema.activities, and(eq(s.ownerType, 'activity'), eq(schema.activities.id, s.ownerId)))
    .leftJoin(schema.scheduleSlots, eq(schema.scheduleSlots.id, s.slotId))
    .leftJoin(schema.subjects, eq(schema.subjects.id, schema.scheduleSlots.subjectId))
    .where(and(...where))
    .orderBy(desc(c.createdAt))
    .limit(200);
}
export type CorrectionRow = Awaited<ReturnType<typeof listCorrections>>[number];

export async function lockCorrection(tx: Tx, id: string) {
  const [row] = await tx.select().from(c).where(eq(c.id, id)).for('update');
  return row;
}

export async function decideCorrection(tx: Tx, id: string, values: { status: 'approved' | 'rejected'; decidedBy: string; decisionNote: string | null }) {
  await tx.update(c).set({ ...values, decidedAt: new Date() }).where(eq(c.id, id));
}
