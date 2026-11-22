import { schema, sensitive } from '@absah/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/shared/db';
import { buildTestApp } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let other: string;
let teacher: string;
let substitute: string;
let sessionId: string;
let attendanceId: string;
let leaveId: string;
let substitutionId: string;

/** The Postgres message behind a failed query (Drizzle wraps it), or null when the query went through. */
const refusal = async (query: Promise<unknown>): Promise<string | null> => {
  try {
    await query;
    return null;
  } catch (err) {
    return (err as { cause?: { message?: string } }).cause?.message ?? String(err);
  }
};

beforeAll(async () => {
  school = await t.school('smp', 'SMP Guru Skema');
  other = await t.school('smp', 'SMP Guru Lain');
  teacher = (await t.staff('Pak Guru Skema')).id;
  substitute = (await t.staff('Bu Pengganti Skema')).id;
  await t.member(school, teacher, 'guru');
  await t.member(school, substitute, 'guru');
  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [session] = await tx
      .insert(schema.attendanceSessions)
      .values({ schoolId: school, schoolDate: '2026-11-23', mode: 'daily', ownerType: 'class', ownerId: crypto.randomUUID(), teacherId: teacher })
      .returning();
    sessionId = session?.id ?? '';
    const [row] = await tx
      .insert(schema.teacherAttendance)
      .values({ schoolId: school, userId: teacher, schoolDate: '2026-11-23', checkedInAt: new Date('2026-11-23T00:05:00Z'), source: 'app' })
      .returning();
    attendanceId = row?.id ?? '';
    const [leave] = await tx
      .insert(schema.teacherLeaves)
      .values({ schoolId: school, userId: teacher, kind: 'sakit', startsOn: '2026-11-23', endsOn: '2026-11-24', reason: sensitive('Demam') })
      .returning();
    leaveId = leave?.id ?? '';
    const [sub] = await tx.insert(schema.sessionSubstitutions).values({ schoolId: school, sessionId, fromTeacherId: teacher, substituteId: substitute }).returning();
    substitutionId = sub?.id ?? '';
  });
});

describe('teacher tables (GRU-01..03)', () => {
  it('are visible to their own school and to no other', async () => {
    const own = await withTenant({ schoolId: school, userId: null }, async (tx) => ({
      attendance: await tx.select().from(schema.teacherAttendance),
      leaves: await tx.select().from(schema.teacherLeaves),
      substitutions: await tx.select().from(schema.sessionSubstitutions),
    }));
    expect([own.attendance.length, own.leaves.length, own.substitutions.length]).toEqual([1, 1, 1]);
    const foreign = await withTenant({ schoolId: other, userId: null }, async (tx) => ({
      attendance: await tx.select().from(schema.teacherAttendance),
      leaves: await tx.select().from(schema.teacherLeaves),
      substitutions: await tx.select().from(schema.sessionSubstitutions),
    }));
    expect([foreign.attendance.length, foreign.leaves.length, foreign.substitutions.length]).toEqual([0, 0, 0]);
  });

  it('refuses a row written into another school', async () => {
    const message = await refusal(
      withTenant({ schoolId: other, userId: null }, (tx) =>
        tx.insert(schema.teacherAttendance).values({ schoolId: school, userId: teacher, schoolDate: '2026-11-24', checkedInAt: new Date(), source: 'app' }),
      ),
    );
    expect(message).toMatch(/row-level security/);
  });

  it('keeps one attendance row per teacher per day', async () => {
    const message = await refusal(
      withTenant({ schoolId: school, userId: null }, (tx) =>
        tx.insert(schema.teacherAttendance).values({ schoolId: school, userId: teacher, schoolDate: '2026-11-23', checkedInAt: new Date(), source: 'kiosk' }),
      ),
    );
    expect(message).toMatch(/teacher_attendance_user_date_key/);
  });

  it('lets only the check-out time of an attendance row change, and never deletes it', async () => {
    // Positive control: the allowed column goes through.
    expect(await refusal(withTenant({ schoolId: school, userId: null }, (tx) => tx.update(schema.teacherAttendance).set({ checkedOutAt: new Date('2026-11-23T08:00:00Z') }).where(eq(schema.teacherAttendance.id, attendanceId))))).toBeNull();
    for (const set of [{ late: true }, { checkedInAt: new Date() }, { userId: substitute }, { source: 'kiosk' as const }]) {
      const message = await refusal(withTenant({ schoolId: school, userId: null }, (tx) => tx.update(schema.teacherAttendance).set(set).where(eq(schema.teacherAttendance.id, attendanceId))));
      expect(message, JSON.stringify(set)).toMatch(/permission denied/);
    }
    expect(await refusal(withTenant({ schoolId: school, userId: null }, (tx) => tx.delete(schema.teacherAttendance).where(eq(schema.teacherAttendance.id, attendanceId))))).toMatch(/permission denied/);
  });

  it('rejects a check-out before the check-in', async () => {
    const message = await refusal(withTenant({ schoolId: school, userId: null }, (tx) => tx.update(schema.teacherAttendance).set({ checkedOutAt: new Date('2026-11-22T00:00:00Z') }).where(eq(schema.teacherAttendance.id, attendanceId))));
    expect(message).toMatch(/teacher_attendance_out_after_in_check/);
  });

  it('lets a leave be decided or cancelled but not rewritten, and never deleted', async () => {
    expect(await refusal(withTenant({ schoolId: school, userId: null }, (tx) => tx.update(schema.teacherLeaves).set({ status: 'approved', decidedAt: new Date(), decidedBy: substitute }).where(eq(schema.teacherLeaves.id, leaveId))))).toBeNull();
    for (const set of [{ endsOn: '2026-12-31' }, { userId: substitute }, { kind: 'izin' as const }]) {
      const message = await refusal(withTenant({ schoolId: school, userId: null }, (tx) => tx.update(schema.teacherLeaves).set(set).where(eq(schema.teacherLeaves.id, leaveId))));
      expect(message, JSON.stringify(set)).toMatch(/permission denied/);
    }
    expect(await refusal(withTenant({ schoolId: school, userId: null }, (tx) => tx.delete(schema.teacherLeaves).where(eq(schema.teacherLeaves.id, leaveId))))).toMatch(/permission denied/);
  });

  it('rejects a leave that ends before it starts', async () => {
    const message = await refusal(
      withTenant({ schoolId: school, userId: null }, (tx) => tx.insert(schema.teacherLeaves).values({ schoolId: school, userId: teacher, kind: 'izin', startsOn: '2026-12-02', endsOn: '2026-12-01', reason: sensitive('x') })),
    );
    expect(message).toMatch(/teacher_leaves_range_check/);
  });

  it('keeps the leave reason encrypted at rest', async () => {
    const result = await withTenant({ schoolId: school, userId: null }, (tx) => tx.execute(sql`select reason from teacher_leaves where id = ${leaveId}`));
    expect(String((result.rows[0] as { reason: string }).reason)).not.toContain('Demam');
  });

  it('keeps substitutions as an insert-only history', async () => {
    for (const run of [
      (tx: Parameters<Parameters<typeof withTenant>[1]>[0]) => tx.update(schema.sessionSubstitutions).set({ substituteId: teacher }).where(eq(schema.sessionSubstitutions.id, substitutionId)),
      (tx: Parameters<Parameters<typeof withTenant>[1]>[0]) => tx.delete(schema.sessionSubstitutions).where(eq(schema.sessionSubstitutions.id, substitutionId)),
    ]) {
      expect(await refusal(withTenant({ schoolId: school, userId: null }, (tx) => run(tx)))).toMatch(/permission denied/);
    }
  });
});
