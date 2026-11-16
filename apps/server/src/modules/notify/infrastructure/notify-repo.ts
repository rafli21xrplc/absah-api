import { schema, type Tx } from '@absah/db';
import { and, asc, eq, inArray, isNotNull, isNull, lte, sql } from 'drizzle-orm';

const n = schema.notifications;

export async function schoolOf(tx: Tx, schoolId: string) {
  const [row] = await tx.select({ name: schema.schools.name, timezone: schema.schools.timezone }).from(schema.schools).where(eq(schema.schools.id, schoolId));
  return row;
}

/** The student's name and the guardians with a WhatsApp number. */
export async function guardiansOf(tx: Tx, enrollmentId: string) {
  const rows = await tx
    .select({ studentId: schema.students.id, studentName: schema.students.name, guardianId: schema.guardians.id, phone: schema.guardians.phone })
    .from(schema.enrollments)
    .innerJoin(schema.students, eq(schema.students.id, schema.enrollments.studentId))
    .innerJoin(schema.studentGuardians, eq(schema.studentGuardians.studentId, schema.students.id))
    .innerJoin(schema.guardians, eq(schema.guardians.id, schema.studentGuardians.guardianId))
    .where(and(eq(schema.enrollments.id, enrollmentId), isNotNull(schema.guardians.phone)))
    .orderBy(asc(schema.guardians.id));
  return rows.flatMap((r) => (r.phone ? [{ studentId: r.studentId, studentName: r.studentName, guardianId: r.guardianId, phone: r.phone.reveal() }] : []));
}

export async function sessionDate(tx: Tx, sessionId: string) {
  const [row] = await tx.select({ schoolDate: schema.attendanceSessions.schoolDate }).from(schema.attendanceSessions).where(eq(schema.attendanceSessions.id, sessionId));
  return row?.schoolDate;
}

export async function leaveOf(tx: Tx, leaveRequestId: string) {
  const l = schema.leaveRequests;
  const [row] = await tx
    .select({ enrollmentId: l.enrollmentId, kind: l.kind, startsOn: l.startsOn, endsOn: l.endsOn, status: l.status })
    .from(l)
    .where(eq(l.id, leaveRequestId));
  return row;
}

export type NewNotification = typeof n.$inferInsert;

/** Inserts the rows not seen before (dedup_key); returns the new ids with their release time. */
/** Dedup keys already used, so no link is minted for a message that will not be sent. */
export async function usedDedupKeys(tx: Tx, keys: string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set();
  const rows = await tx.select({ key: n.dedupKey }).from(n).where(inArray(n.dedupKey, keys));
  return new Set(rows.map((r) => r.key));
}

export function insertNotifications(tx: Tx, rows: NewNotification[]) {
  if (rows.length === 0) return Promise.resolve([]);
  return tx.insert(n).values(rows).onConflictDoNothing().returning({ id: n.id, scheduledFor: n.scheduledFor });
}

export async function markReleased(tx: Tx, ids: string[], at: Date) {
  for (const id of ids) await tx.update(n).set({ releasedAt: at }).where(eq(n.id, id));
}

/** Due, unreleased notifications of the current school, locked for this release run. */
export function dueNotifications(tx: Tx, now: Date, limit = 500) {
  return tx
    .select({ id: n.id })
    .from(n)
    .where(and(isNull(n.releasedAt), lte(n.scheduledFor, now)))
    .orderBy(asc(n.scheduledFor))
    .limit(limit)
    .for('update', { skipLocked: true });
}

export async function forSend(tx: Tx, id: string) {
  const [row] = await tx
    .select({
      id: n.id,
      status: n.status,
      templateCode: n.templateCode,
      language: n.language,
      toPhone: n.toPhone,
      params: n.params,
      template: { body: schema.messageTemplates.body, params: schema.messageTemplates.params, providerName: schema.messageTemplates.providerName, approval: schema.messageTemplates.approval },
    })
    .from(n)
    .leftJoin(schema.messageTemplates, and(eq(schema.messageTemplates.code, n.templateCode), eq(schema.messageTemplates.language, n.language)))
    .where(eq(n.id, id))
    .for('update', { of: n });
  return row;
}

export async function markSent(tx: Tx, id: string, providerMessageId: string, attempts: number, at: Date) {
  await tx.update(n).set({ status: 'sent', providerMessageId, attempts, sentAt: at, lastError: null }).where(eq(n.id, id));
}

export async function markFailed(tx: Tx, id: string, error: string, attempts: number, at: Date) {
  await tx.update(n).set({ status: 'failed', lastError: error.slice(0, 200), attempts, failedAt: at }).where(eq(n.id, id));
}

/** Schools with due unreleased notifications. Platform read for the release job only. */
export const dueSchoolsSql = (now: Date) =>
  sql`select distinct school_id from notifications where released_at is null and scheduled_for <= ${now.toISOString()}::timestamptz`;
