import { KAIH_HABITS, type HabitCode } from '@absah/contracts';
import { schema, type Tx } from '@absah/db';
import { and, asc, between, eq, inArray, sql } from 'drizzle-orm';

const h = schema.habitEntries;

export interface HabitTally {
  habit: HabitCode;
  /** Days the habit was ticked yes / days it was filled at all. */
  yes: number;
  filled: number;
}

export interface ActivityTally {
  activityId: string;
  name: string;
  kind: string;
  /** Sessions of the activity in the range that the student has a record in, and those where they were hadir or terlambat. */
  recorded: number;
  present: number;
}

/** The 7 KAIH habits (incl. ibadah) per enrollment in a date range; every habit appears, filled 0 when never ticked. */
export async function habitTallies(tx: Tx, enrollmentIds: string[], from: string, to: string): Promise<Map<string, HabitTally[]>> {
  const out = new Map<string, HabitTally[]>();
  if (enrollmentIds.length === 0) return out;
  const rows = await tx
    .select({ enrollmentId: h.enrollmentId, habit: h.habit, yes: sql<number>`count(*) filter (where ${h.value})::int`, filled: sql<number>`count(*)::int` })
    .from(h)
    .where(and(inArray(h.enrollmentId, enrollmentIds), between(h.schoolDate, from, to)))
    .groupBy(h.enrollmentId, h.habit);
  for (const id of enrollmentIds) {
    out.set(
      id,
      KAIH_HABITS.map((habit) => {
        const row = rows.find((r) => r.enrollmentId === id && r.habit === habit);
        return { habit, yes: row?.yes ?? 0, filled: row?.filled ?? 0 };
      }),
    );
  }
  return out;
}

/** The activities each enrollment belongs to, with how often the student was present in the activity's sessions in the range. */
export async function activityTallies(tx: Tx, enrollmentIds: string[], from: string, to: string): Promise<Map<string, ActivityTally[]>> {
  const out = new Map<string, ActivityTally[]>();
  if (enrollmentIds.length === 0) return out;
  const m = schema.activityMembers;
  const a = schema.activities;
  const members = await tx
    .select({ enrollmentId: m.enrollmentId, activityId: a.id, name: a.name, kind: a.kind })
    .from(m)
    .innerJoin(a, eq(a.id, m.activityId))
    .where(inArray(m.enrollmentId, enrollmentIds))
    .orderBy(asc(a.name));
  const s = schema.attendanceSessions;
  const r = schema.attendanceRecords;
  const records = await tx
    .select({ enrollmentId: r.enrollmentId, activityId: s.activityId, recorded: sql<number>`count(*)::int`, present: sql<number>`count(*) filter (where ${r.status} in ('H', 'T'))::int` })
    .from(r)
    .innerJoin(s, eq(s.id, r.sessionId))
    .where(and(inArray(r.enrollmentId, enrollmentIds), eq(s.mode, 'activity'), between(s.schoolDate, from, to)))
    .groupBy(r.enrollmentId, s.activityId);
  for (const row of members) {
    const rec = records.find((x) => x.enrollmentId === row.enrollmentId && x.activityId === row.activityId);
    const list = out.get(row.enrollmentId) ?? [];
    list.push({ activityId: row.activityId, name: row.name, kind: row.kind, recorded: rec?.recorded ?? 0, present: rec?.present ?? 0 });
    out.set(row.enrollmentId, list);
  }
  return out;
}
