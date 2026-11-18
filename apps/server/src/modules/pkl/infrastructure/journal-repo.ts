import { schema, type Tx } from '@absah/db';
import { and, desc, eq, gte, lte, or, sql, type SQL } from 'drizzle-orm';

const j = schema.pklJournals;
const pl = schema.pklPlacements;

export interface JournalFilter {
  id?: string;
  placementId?: string;
  status?: (typeof j.$inferSelect)['status'];
  from?: string;
  to?: string;
  /** The student's own (students.user_id). */
  studentUserId?: string;
  /** Placements the user supervises (school or industry). */
  supervisorId?: string;
}

export function listJournals(tx: Tx, filter: JournalFilter) {
  const where: SQL[] = [];
  if (filter.id) where.push(eq(j.id, filter.id));
  if (filter.placementId) where.push(eq(j.placementId, filter.placementId));
  if (filter.status) where.push(eq(j.status, filter.status));
  if (filter.from) where.push(gte(j.schoolDate, filter.from));
  if (filter.to) where.push(lte(j.schoolDate, filter.to));
  if (filter.studentUserId) where.push(eq(schema.students.userId, filter.studentUserId));
  if (filter.supervisorId) {
    const sup = or(eq(pl.schoolMentorId, filter.supervisorId), eq(pl.industryMentorId, filter.supervisorId));
    if (sup) where.push(sup);
  }
  return tx
    .select({
      id: j.id,
      placementId: j.placementId,
      schoolMentorId: pl.schoolMentorId,
      industryMentorId: pl.industryMentorId,
      studentName: schema.students.name,
      className: schema.classes.name,
      partnerName: schema.dudiPartners.name,
      date: j.schoolDate,
      activity: j.activity,
      competency: j.competency,
      attachmentKey: j.attachmentKey,
      attachmentType: j.attachmentType,
      status: j.status,
      reviewNote: j.reviewNote,
      reviewer: sql<string | null>`(select d.name from school_member_directory d where d.user_id = pkl_journals.reviewed_by limit 1)`,
      reviewedAt: j.reviewedAt,
    })
    .from(j)
    .innerJoin(pl, eq(pl.id, j.placementId))
    .innerJoin(schema.dudiPartners, eq(schema.dudiPartners.id, pl.partnerId))
    .innerJoin(schema.enrollments, eq(schema.enrollments.id, pl.enrollmentId))
    .innerJoin(schema.students, eq(schema.students.id, schema.enrollments.studentId))
    .innerJoin(schema.classes, eq(schema.classes.id, schema.enrollments.classId))
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(desc(j.schoolDate), desc(j.id))
    .limit(500);
}
export type JournalRow = Awaited<ReturnType<typeof listJournals>>[number];

export async function lockJournal(tx: Tx, placementId: string, date: string) {
  const [row] = await tx.select().from(j).where(and(eq(j.placementId, placementId), eq(j.schoolDate, date))).for('update');
  return row;
}

export async function lockJournalById(tx: Tx, id: string) {
  const [row] = await tx.select().from(j).where(eq(j.id, id)).for('update');
  return row;
}

export async function insertJournal(tx: Tx, values: typeof j.$inferInsert): Promise<void> {
  await tx.insert(j).values(values);
}

export async function updateJournal(tx: Tx, id: string, values: Partial<typeof j.$inferInsert>): Promise<void> {
  await tx.update(j).set({ ...values, updatedAt: new Date() }).where(eq(j.id, id));
}
