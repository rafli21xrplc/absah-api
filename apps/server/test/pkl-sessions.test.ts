import { schema, sensitive } from '@absah/db';
import { and, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findSchool, generateForSchool, lockDueDays, openPklSession, setPklStatus } from '../src/modules/attendance';
import { getDb, withPlatform, withTenant } from '../src/shared/db';
import { addDays, schoolDate } from '../src/shared/school-date';
import { buildTestApp, signIn } from './harness';
import { pklWorld, type PklWorld } from './pkl-fixtures';

const t = buildTestApp();
afterAll(() => t.cleanup());

/** A Monday well ahead, its Saturday and Sunday, and a holiday Wednesday. */
const today = schoolDate('Asia/Jakarta');
let monday = addDays(today, 14);
while (new Date(`${monday}T00:00:00Z`).getUTCDay() !== 1) monday = addDays(monday, 1);
const wednesday = addDays(monday, 2);
const saturday = addDays(monday, 5);
const sunday = addDays(monday, 6);

let w: PklWorld;
const placements: Record<'rizky' | 'sinta' | 'bayu', string> = { rizky: '', sinta: '', bayu: '' };

async function generate(date: string) {
  const row = await withPlatform((tx) => findSchool(tx, w.school));
  if (!row) throw new Error('no school');
  return generateForSchool(row, date, new Date());
}

/** PKL sessions of a date: placement id -> session. */
async function pklSessions(date: string) {
  const s = schema.attendanceSessions;
  const rows = await getDb()
    .db.select({ id: s.id, placementId: s.pklPlacementId, status: s.status, ownerType: s.ownerType })
    .from(s)
    .where(and(eq(s.schoolId, w.school), eq(s.schoolDate, date), eq(s.mode, 'pkl')));
  return new Map(rows.map((r) => [r.placementId, r]));
}

const daily = async (enrollmentId: string, date: string) =>
  (await getDb().db.select({ status: schema.dailyAttendance.status }).from(schema.dailyAttendance).where(and(eq(schema.dailyAttendance.enrollmentId, enrollmentId), eq(schema.dailyAttendance.schoolDate, date))))[0]?.status ?? null;

beforeAll(async () => {
  w = await pklWorld(t, 'SMK Sesi PKL');
  await withTenant({ schoolId: w.school, userId: null }, async (tx) => {
    // PT Maju Jaya also works on Saturday.
    await tx.insert(schema.dudiWorkHours).values({ schoolId: w.school, partnerId: w.partners.maju, day: 6, startsAt: '08:00', endsAt: '12:00' });
    await tx.insert(schema.calendarDays).values({ schoolId: w.school, date: wednesday, kind: 'holiday', name: 'Libur uji' });
    const rows = await tx
      .insert(schema.pklPlacements)
      .values([
        { schoolId: w.school, enrollmentId: w.enrollments.rizky, partnerId: w.partners.maju, startsOn: monday, endsOn: addDays(monday, 30) },
        { schoolId: w.school, enrollmentId: w.enrollments.sinta, partnerId: w.partners.sentosa, startsOn: monday, endsOn: addDays(monday, 30) },
        { schoolId: w.school, enrollmentId: w.enrollments.bayu, partnerId: w.partners.maju, startsOn: addDays(monday, 1), endsOn: addDays(monday, 30) },
      ])
      .returning();
    placements.rizky = rows[0]?.id ?? '';
    placements.sinta = rows[1]?.id ?? '';
    placements.bayu = rows[2]?.id ?? '';
  });
});

describe('PKL sessions on the session engine (PKL-02)', () => {
  it('generates one pkl session per running placement on DUDI work days', async () => {
    await generate(monday);
    const mon = await pklSessions(monday);
    expect([...mon.keys()].sort()).toEqual([placements.rizky, placements.sinta].sort());
    expect(mon.get(placements.rizky)?.ownerType).toBe('placement');
    // A second run (or a forced one) adds nothing.
    await withPlatform(async (tx) => {
      const row = await findSchool(tx, w.school);
      if (row) await generateForSchool(row, monday, new Date(), { force: true });
    });
    expect((await pklSessions(monday)).size).toBe(2);
  });

  it('uses the DUDI week on a Saturday without lessons, and skips holidays and closed days', async () => {
    await generate(saturday);
    expect([...(await pklSessions(saturday)).keys()].sort()).toEqual([placements.rizky, placements.bayu].sort());
    await generate(sunday);
    expect((await pklSessions(sunday)).size).toBe(0);
    await generate(wednesday);
    expect((await pklSessions(wednesday)).size).toBe(0);
  });

  it('lets approved izin cover a PKL day', async () => {
    const tuesday = addDays(monday, 1);
    await withTenant({ schoolId: w.school, userId: null }, (tx) =>
      tx.insert(schema.leaveRequests).values({ schoolId: w.school, enrollmentId: w.enrollments.sinta, kind: 'sakit', startsOn: tuesday, endsOn: tuesday, reason: sensitive('Demam'), status: 'approved' }),
    );
    await generate(tuesday);
    const session = (await pklSessions(tuesday)).get(placements.sinta);
    const [record] = await getDb().db.select().from(schema.attendanceRecords).where(eq(schema.attendanceRecords.sessionId, session?.id ?? ''));
    expect(record).toMatchObject({ status: 'S', source: 'leave' });
  });

  it('counts a PKL decision in the daily rekap and tells parents about an alpa', async () => {
    const mon = await pklSessions(monday);
    await withTenant({ schoolId: w.school, userId: null }, async (tx) => {
      await setPklStatus(tx, w.school, { sessionId: mon.get(placements.rizky)?.id ?? '', enrollmentId: w.enrollments.rizky, status: 'H', sourceRef: null, recordedBy: null });
      await setPklStatus(tx, w.school, { sessionId: mon.get(placements.sinta)?.id ?? '', enrollmentId: w.enrollments.sinta, status: 'A', sourceRef: null, recordedBy: w.users.pembimbing });
    });
    expect(await daily(w.enrollments.rizky, monday)).toBe('H');
    expect(await daily(w.enrollments.sinta, monday)).toBe('A');
    const events = await getDb().db.execute<{ n: number }>(
      sql`select count(*)::int as n from outbox_events where school_id = ${w.school}::uuid and type = 'attendance.absent_marked' and payload->>'enrollmentId' = ${w.enrollments.sinta}`,
    );
    expect(events.rows[0]?.n).toBe(1);
  });

  it('opens a missing PKL session later, locked when the day is already locked', async () => {
    const thursday = addDays(monday, 3);
    await generate(thursday);
    await withTenant({ schoolId: w.school, userId: null }, (tx) => tx.delete(schema.attendanceSessions).where(and(eq(schema.attendanceSessions.schoolDate, thursday), eq(schema.attendanceSessions.mode, 'pkl'))));
    await lockDueDays(new Date(`${addDays(thursday, 1)}T01:00:00+07:00`));
    const id = await withTenant({ schoolId: w.school, userId: null }, (tx) => openPklSession(tx, w.school, placements.bayu, thursday));
    const again = await withTenant({ schoolId: w.school, userId: null }, (tx) => openPklSession(tx, w.school, placements.bayu, thursday));
    expect(again).toBe(id);
    expect((await pklSessions(thursday)).get(placements.bayu)?.status).toBe('locked');
  });

  it('refuses filling a PKL session through the session endpoint, even for a manager', async () => {
    const tuesday = addDays(monday, 1);
    const session = (await pklSessions(tuesday)).get(placements.bayu);
    const admin = await t.staff('Bu admin');
    await t.member(w.school, admin.id, 'wakasek');
    const agent = t.agent();
    await signIn(agent, admin.email).expect(200);
    await agent
      .post(`/api/v1/sessions/${session?.id ?? ''}/submit`)
      .set('X-School-Id', w.school)
      .set('Idempotency-Key', `pkl-${uuidv7()}`)
      .send({ exceptions: [] })
      .expect(403);
  });
});
