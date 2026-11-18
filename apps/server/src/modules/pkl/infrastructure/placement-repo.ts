import { schema, type Tx } from '@absah/db';
import { and, asc, eq, gte, inArray, lte, ne, sql, type SQL } from 'drizzle-orm';

const pl = schema.pklPlacements;
const e = schema.enrollments;

/** Serialises placement writes of one school, so two batches cannot both pass the overlap check. */
export async function lockPlacements(tx: Tx, schoolId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`pkl-placements:${schoolId}`}, 0))`);
}

const directoryName = (col: SQL) =>
  sql<string | null>`(select d.name from school_member_directory d where d.user_id = ${col} limit 1)`;

export interface PlacementFilter {
  id?: string;
  partnerId?: string;
  schoolMentorId?: string;
  industryMentorId?: string;
  /** Not cancelled and ending today or later. */
  currentOn?: string;
}

export function listPlacements(tx: Tx, filter: PlacementFilter) {
  const where: SQL[] = [];
  if (filter.id) where.push(eq(pl.id, filter.id));
  if (filter.partnerId) where.push(eq(pl.partnerId, filter.partnerId));
  if (filter.schoolMentorId) where.push(eq(pl.schoolMentorId, filter.schoolMentorId));
  if (filter.industryMentorId) where.push(eq(pl.industryMentorId, filter.industryMentorId));
  if (filter.currentOn) where.push(eq(pl.status, 'active'), gte(pl.endsOn, filter.currentOn));
  return tx
    .select({
      id: pl.id,
      studentId: schema.students.id,
      enrollmentId: pl.enrollmentId,
      studentName: schema.students.name,
      className: schema.classes.name,
      partnerId: pl.partnerId,
      partnerName: schema.dudiPartners.name,
      startsOn: pl.startsOn,
      endsOn: pl.endsOn,
      status: pl.status,
      schoolMentorId: pl.schoolMentorId,
      // Qualified by hand: a bare user_id would bind to the view's own column (CLAUDE.md, TPPK pitfall).
      schoolMentorName: directoryName(sql`pkl_placements.school_mentor_id`),
      industryMentorId: pl.industryMentorId,
      industryMentorName: directoryName(sql`pkl_placements.industry_mentor_id`),
      industryMentorPhone: sql<string | null>`(select c.phone_number from pkl_mentor_contacts c where c.user_id = pkl_placements.industry_mentor_id)`,
    })
    .from(pl)
    .innerJoin(e, eq(e.id, pl.enrollmentId))
    .innerJoin(schema.students, eq(schema.students.id, e.studentId))
    .innerJoin(schema.classes, eq(schema.classes.id, e.classId))
    .innerJoin(schema.dudiPartners, eq(schema.dudiPartners.id, pl.partnerId))
    .where(where.length > 0 ? and(...where) : undefined)
    .orderBy(asc(schema.dudiPartners.name), asc(schema.students.name), asc(pl.startsOn), asc(pl.id));
}
export type PlacementRow = Awaited<ReturnType<typeof listPlacements>>[number];

/** Active enrollments of the active year among `ids`. */
export async function activeEnrollments(tx: Tx, ids: string[]): Promise<Set<string>> {
  const rows = await tx
    .select({ id: e.id })
    .from(e)
    .innerJoin(schema.academicYears, eq(schema.academicYears.id, e.academicYearId))
    .where(and(inArray(e.id, ids), eq(e.status, 'active'), eq(schema.academicYears.isActive, true)));
  return new Set(rows.map((r) => r.id));
}

export async function partnerState(tx: Tx, partnerId: string) {
  const [row] = await tx.select({ active: schema.dudiPartners.active }).from(schema.dudiPartners).where(eq(schema.dudiPartners.id, partnerId));
  return row;
}

/** Enrollments among `ids` with an active placement overlapping [from, to], except `exceptId`. */
export async function overlapping(tx: Tx, ids: string[], from: string, to: string, exceptId?: string): Promise<string[]> {
  const where = [inArray(pl.enrollmentId, ids), eq(pl.status, 'active'), lte(pl.startsOn, to), gte(pl.endsOn, from)];
  if (exceptId) where.push(ne(pl.id, exceptId));
  const rows = await tx.selectDistinct({ id: pl.enrollmentId }).from(pl).where(and(...where));
  return rows.map((r) => r.id).sort();
}

export async function insertPlacements(tx: Tx, rows: (typeof pl.$inferInsert)[]): Promise<void> {
  await tx.insert(pl).values(rows);
}

export async function updatePlacement(tx: Tx, id: string, values: Partial<typeof pl.$inferInsert>): Promise<void> {
  await tx.update(pl).set({ ...values, updatedAt: new Date() }).where(eq(pl.id, id));
}

/** Placements of an industry supervisor that still give access: not cancelled, ending today or later. */
export async function currentPlacementCount(tx: Tx, userId: string, today: string): Promise<number> {
  const [row] = await tx
    .select({ n: sql<number>`count(*)::int` })
    .from(pl)
    .where(and(eq(pl.industryMentorId, userId), eq(pl.status, 'active'), gte(pl.endsOn, today)));
  return row?.n ?? 0;
}

/** Industry supervisors with an active membership in the current school. */
export async function activeIndustryMentors(tx: Tx): Promise<string[]> {
  const m = schema.memberships;
  const rows = await tx.select({ userId: m.userId }).from(m).where(and(eq(m.role, 'pembimbing_industri'), eq(m.status, 'active')));
  return rows.map((r) => r.userId);
}

/** A student's own PWA login (students.user_id) is never an industry supervisor. */
export async function isStudentLogin(tx: Tx, userId: string): Promise<boolean> {
  const [row] = await tx.select({ id: schema.students.id }).from(schema.students).where(eq(schema.students.userId, userId)).limit(1);
  return row !== undefined;
}
