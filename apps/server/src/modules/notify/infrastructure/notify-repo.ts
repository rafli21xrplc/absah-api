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

/** A UKS visit that sent the student home; null for other outcomes (no message). */
export async function sentHomeVisit(tx: Tx, uksVisitId: string) {
  const u = schema.uksVisits;
  const [row] = await tx.select({ enrollmentId: u.enrollmentId, visitedAt: u.visitedAt, outcome: u.outcome }).from(u).where(eq(u.id, uksVisitId));
  return row?.outcome === 'dipulangkan' ? row : null;
}

/** A released check-out (GRB-10): who picked the student up and when. */
export async function releasedPickup(tx: Tx, pickupEventId: string) {
  const pe = schema.pickupEvents;
  const [row] = await tx.select({ enrollmentId: pe.enrollmentId, pickupName: pe.pickupName, checkedOutAt: pe.checkedOutAt, status: pe.status }).from(pe).where(eq(pe.id, pickupEventId));
  return row?.status === 'released' && row.checkedOutAt ? { ...row, checkedOutAt: row.checkedOutAt } : null;
}

/** A held unlisted penjemput (GRB-10): who is at the gate and since when. */
export async function heldPickup(tx: Tx, pickupEventId: string) {
  const pe = schema.pickupEvents;
  const [row] = await tx.select({ enrollmentId: pe.enrollmentId, pickupName: pe.pickupName, createdAt: pe.createdAt, status: pe.status }).from(pe).where(eq(pe.id, pickupEventId));
  return row?.status === 'held' ? row : null;
}

/** The PIC MBG's WhatsApp number (RKP-08), if the school set one. */
export async function mbgPicPhone(tx: Tx): Promise<string | null> {
  const [row] = await tx.select({ phone: schema.mbgSettings.picPhone }).from(schema.mbgSettings);
  return row?.phone?.reveal() ?? null;
}

/** The stored H-3 forecast of a date per rombel (RKP-09). */
export function mbgForecastRows(tx: Tx, date: string) {
  const f = schema.mbgForecasts;
  const c = schema.classes;
  return tx.select({ name: c.name, forecast: f.forecast }).from(f).innerJoin(c, eq(c.id, f.classId)).where(eq(f.schoolDate, date)).orderBy(asc(c.grade), asc(c.name));
}

/** Current MBG numbers of a date per rombel: rows no correction supersedes. */
export function mbgCurrentCounts(tx: Tx, date: string) {
  const m = schema.mbgDailyCounts;
  const c = schema.classes;
  return tx
    .select({ name: c.name, present: m.presentAtCutoff, unrecorded: m.unrecorded })
    .from(m)
    .innerJoin(c, eq(c.id, m.classId))
    .where(and(eq(m.schoolDate, date), sql`not exists (select 1 from mbg_daily_counts newer where newer.supersedes_id = ${m.id})`))
    .orderBy(asc(c.grade), asc(c.name));
}

/** The school's TPPK members with a WhatsApp number (view tppk.member_contacts: TPPK members only). */
export async function tppkContacts(tx: Tx): Promise<{ userId: string; phone: string }[]> {
  const res = await tx.execute<{ user_id: string; phone_number: string }>(
    sql`select user_id, phone_number from tppk.member_contacts where phone_number is not null order by user_id`,
  );
  return res.rows.map((r) => ({ userId: r.user_id, phone: r.phone_number }));
}

/** Display names of staff of the current school, in the given order (missing ones skipped). */
export async function staffNames(tx: Tx, userIds: string[]): Promise<string[]> {
  if (userIds.length === 0) return [];
  const res = await tx.execute<{ user_id: string; name: string }>(
    sql`select distinct on (user_id) user_id, name from school_member_directory where user_id in (${sql.join(userIds.map((id) => sql`${id}::uuid`), sql`, `)})`,
  );
  const byId = new Map(res.rows.map((r) => [r.user_id, r.name]));
  return userIds.flatMap((id) => (byId.has(id) ? [byId.get(id) ?? ''] : []));
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

/** A buku penghubung message for its notification: who wrote about which student (never the text). */
export async function liaisonNotice(tx: Tx, messageId: string) {
  const res = await tx.execute<{ thread_id: string; student_id: string; student_name: string; sender_id: string | null; sender_role: string; created_at: Date; class_id: string | null }>(sql`
    select m.thread_id, t.student_id, st.name as student_name, m.sender_id, m.sender_role::text as sender_role, m.created_at,
           (select e.class_id from enrollments e join academic_years y on y.id = e.academic_year_id and y.is_active
             where e.student_id = t.student_id and e.status = 'active' limit 1) as class_id
      from communication_messages m
      join communication_threads t on t.id = m.thread_id
      join students st on st.id = t.student_id
     where m.id = ${messageId}::uuid`);
  const r = res.rows[0];
  return r
    ? { threadId: r.thread_id, studentId: r.student_id, studentName: r.student_name, senderId: r.sender_id, senderRole: r.sender_role, createdAt: new Date(r.created_at), classId: r.class_id }
    : undefined;
}

/** Service hours as local minutes (06.00-18.00 until the admin sets them). */
export async function liaisonWindow(tx: Tx): Promise<{ start: number; end: number }> {
  const [row] = await tx.select({ startsAt: schema.liaisonSettings.startsAt, endsAt: schema.liaisonSettings.endsAt }).from(schema.liaisonSettings);
  const minutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  return { start: minutes(row?.startsAt ?? '06:00'), end: minutes(row?.endsAt ?? '18:00') };
}

export async function homeroomContact(tx: Tx, classId: string): Promise<{ userId: string; phone: string } | undefined> {
  const res = await tx.execute<{ user_id: string; phone_number: string | null }>(sql`select user_id, phone_number from homeroom_contacts where class_id = ${classId}::uuid`);
  const r = res.rows[0];
  return r?.phone_number ? { userId: r.user_id, phone: r.phone_number } : undefined;
}

/** Guardians of the student who can sign in to read the thread (a portal account) and have a number. */
export async function portalGuardians(tx: Tx, studentId: string): Promise<{ guardianId: string; userId: string; phone: string }[]> {
  const rows = await tx
    .select({ guardianId: schema.guardians.id, userId: schema.guardians.userId, phone: schema.guardians.phone })
    .from(schema.studentGuardians)
    .innerJoin(schema.guardians, eq(schema.guardians.id, schema.studentGuardians.guardianId))
    .where(and(eq(schema.studentGuardians.studentId, studentId), isNotNull(schema.guardians.userId), isNotNull(schema.guardians.phone)))
    .orderBy(asc(schema.guardians.id));
  return rows.flatMap((r) => (r.phone && r.userId ? [{ guardianId: r.guardianId, userId: r.userId, phone: r.phone.reveal() }] : []));
}

/**
 * PKL-01: the number of an industry supervisor of the current school (view pkl_mentor_contacts) and
 * how many of their placements have not ended on `today`.
 */
export async function pklMentorNotice(tx: Tx, userId: string, today: string): Promise<{ phone: string; count: number } | undefined> {
  const res = await tx.execute<{ phone_number: string | null; n: number }>(sql`
    select c.phone_number,
           (select count(*)::int from pkl_placements p
             where p.industry_mentor_id = c.user_id and p.status = 'active' and p.ends_on >= ${today}::date) as n
      from pkl_mentor_contacts c where c.user_id = ${userId}::uuid`);
  const r = res.rows[0];
  return r?.phone_number && r.n > 0 ? { phone: r.phone_number, count: r.n } : undefined;
}
