import type { LeaveStatus, TeacherLeaveKind } from '@absah/contracts';
import { schema, sensitive, type Tx } from '@absah/db';
import { and, desc, eq, gte, inArray, lte, sql, type AnyColumn, type SQL } from 'drizzle-orm';
import { directoryName } from '../../../shared/directory-name';

const l = schema.teacherLeaves;
const name = (column: AnyColumn) => directoryName(column);

/** Serializes the izin of one teacher so two overlapping requests cannot both pass. */
export async function lockTeacherLeaves(tx: Tx, userId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`teacher-leave:${userId}`}, 0))`);
}

export async function hasOverlap(tx: Tx, userId: string, range: { startsOn: string; endsOn: string }): Promise<boolean> {
  const [row] = await tx
    .select({ id: l.id })
    .from(l)
    .where(and(eq(l.userId, userId), inArray(l.status, ['pending', 'approved']), lte(l.startsOn, range.endsOn), gte(l.endsOn, range.startsOn)))
    .limit(1);
  return row !== undefined;
}

export async function insertLeave(tx: Tx, values: { id: string; schoolId: string; userId: string; kind: TeacherLeaveKind; startsOn: string; endsOn: string; reason: string }): Promise<void> {
  await tx.insert(l).values({ ...values, reason: sensitive(values.reason) });
}

export async function lockLeave(tx: Tx, id: string) {
  const [row] = await tx.select({ id: l.id, userId: l.userId, status: l.status, endsOn: l.endsOn }).from(l).where(eq(l.id, id)).for('update');
  return row;
}

export async function updateLeave(tx: Tx, id: string, set: { status: LeaveStatus; decidedBy?: string; decidedAt?: Date; decisionNote?: string | null; cancelledAt?: Date }): Promise<void> {
  await tx.update(l).set(set).where(eq(l.id, id));
}

export async function listLeaves(tx: Tx, filter: { id?: string; status?: LeaveStatus; userId?: string }) {
  const where: SQL[] = [];
  if (filter.id) where.push(eq(l.id, filter.id));
  if (filter.status) where.push(eq(l.status, filter.status));
  if (filter.userId) where.push(eq(l.userId, filter.userId));
  return tx
    .select({
      id: l.id,
      userId: l.userId,
      teacherName: name(l.userId),
      kind: l.kind,
      startsOn: l.startsOn,
      endsOn: l.endsOn,
      reason: l.reason,
      status: l.status,
      decidedBy: l.decidedBy,
      decidedByName: name(l.decidedBy),
      decidedAt: l.decidedAt,
      decisionNote: l.decisionNote,
      cancelledAt: l.cancelledAt,
      createdAt: l.createdAt,
    })
    .from(l)
    .where(and(...where))
    .orderBy(desc(l.startsOn), desc(l.createdAt));
}

export type TeacherLeaveRow = Awaited<ReturnType<typeof listLeaves>>[number];
