import { schema, type Tx } from '@absah/db';
import { and, gte, lte, sql } from 'drizzle-orm';

const a = schema.teacherAttendance;
const lv = schema.teacherLeaves;
const sub = schema.sessionSubstitutions;

export async function checkInsBetween(tx: Tx, from: string, to: string) {
  return tx
    .select({ userId: a.userId, date: a.schoolDate, late: a.late, checkedInAt: a.checkedInAt, checkedOutAt: a.checkedOutAt })
    .from(a)
    .where(and(gte(a.schoolDate, from), lte(a.schoolDate, to)));
}

/** Approved izin that touches the range. */
export async function approvedLeavesBetween(tx: Tx, from: string, to: string) {
  return tx
    .select({ userId: lv.userId, kind: lv.kind, startsOn: lv.startsOn, endsOn: lv.endsOn })
    .from(lv)
    .where(and(sql`${lv.status} = 'approved'`, lte(lv.startsOn, to), gte(lv.endsOn, from)));
}

/** Sessions each person took over, by the school date the change was made on. */
export async function substitutionsTakenBetween(tx: Tx, from: string, to: string, timezone: string): Promise<Map<string, number>> {
  const day = sql`(${sub.createdAt} at time zone ${timezone})::date`;
  const rows = await tx
    .select({ id: sub.substituteId, n: sql<number>`count(*)::int` })
    .from(sub)
    .where(and(sql`${day} >= ${from}::date`, sql`${day} <= ${to}::date`))
    .groupBy(sub.substituteId);
  return new Map(rows.map((r) => [r.id, r.n]));
}

/** Names of the people in the report, from the member directory (an inactive member keeps their history). */
export async function namesOf(tx: Tx, userIds: string[]): Promise<Map<string, string>> {
  if (userIds.length === 0) return new Map();
  const result = await tx.execute(sql`select distinct on (d.user_id) d.user_id as "userId", d.name from school_member_directory d where d.user_id in (${sql.join(userIds.map((id) => sql`${id}::uuid`), sql`, `)}) order by d.user_id`);
  return new Map((result.rows as { userId: string; name: string }[]).map((r) => [r.userId, r.name]));
}
