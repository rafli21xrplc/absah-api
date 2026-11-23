import type { PklCheckin, PklToday } from '@absah/contracts';
import { schema } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { addDays, schoolDate } from '../src/shared/school-date';
import { buildTestApp, signIn, testPhone, type Agent } from './harness';
import { DUDI_POINT, pklWorld, type PklWorld } from './pkl-fixtures';

const t = buildTestApp();
afterAll(() => t.cleanup());

const today = schoolDate('Asia/Jakarta');
/** About `metres` north of the DUDI. */
const north = (metres: number) => ({ latitude: DUDI_POINT.latitude + metres / 111_195, longitude: DUDI_POINT.longitude });
let w: PklWorld;
const students: Record<'rizky' | 'sinta' | 'bayu' | 'dodi', Agent> = {} as never;
const key = () => `pkl-ci-${uuidv7()}`;
const checkin = (agent: Agent, body: object, k: string | null = key(), school = w.school) => {
  const req = agent.post('/api/v1/pkl/checkins').set('X-School-Id', school);
  return (k ? req.set('Idempotency-Key', k) : req).send(body);
};
const body = (kind: 'in' | 'out', point = north(40), deviceTime = new Date()) => ({ kind, ...point, accuracyM: 12.4, deviceTime: deviceTime.toISOString() });

/** A PWA login for a student: an account linked through students.user_id and a siswa membership. */
async function studentAgent(studentId: string, label: string): Promise<Agent> {
  const u = await t.staff(label);
  await getDb().db.update(schema.students).set({ userId: u.id }).where(eq(schema.students.id, studentId));
  await t.member(w.school, u.id, 'siswa');
  const agent = t.agent();
  await signIn(agent, u.email).expect(200);
  return agent;
}

beforeAll(async () => {
  w = await pklWorld(t, 'SMK Check-in');
  const mentor = await t.parent(testPhone(), 'Pak Mandor');
  await t.member(w.school, mentor.id, 'pembimbing_industri');
  await withTenant({ schoolId: w.school, userId: null }, async (tx) => {
    // PT Maju Jaya works around the clock every day, so the tests do not depend on the time they run.
    await tx.delete(schema.dudiWorkHours).where(eq(schema.dudiWorkHours.partnerId, w.partners.maju));
    await tx.insert(schema.dudiWorkHours).values([1, 2, 3, 4, 5, 6, 7].map((day) => ({ schoolId: w.school, partnerId: w.partners.maju, day, startsAt: '00:00', endsAt: '23:59' })));
    const period = { startsOn: addDays(today, -1), endsOn: addDays(today, 30), schoolMentorId: w.users.pembimbing };
    await tx.insert(schema.pklPlacements).values([
      { schoolId: w.school, enrollmentId: w.enrollments.rizky, partnerId: w.partners.maju, industryMentorId: mentor.id, ...period },
      { schoolId: w.school, enrollmentId: w.enrollments.sinta, partnerId: w.partners.maju, industryMentorId: mentor.id, ...period },
      { schoolId: w.school, enrollmentId: w.enrollments.bayu, partnerId: w.partners.maju, ...period },
    ]);
  });
  students.rizky = await studentAgent(w.students.rizky, 'Rizky');
  students.sinta = await studentAgent(w.students.sinta, 'Sinta');
  students.bayu = await studentAgent(w.students.bayu, 'Bayu');
  const dodi = await withTenant({ schoolId: w.school, userId: null }, async (tx) => (await tx.insert(schema.students).values({ schoolId: w.school, name: 'DODI' }).returning())[0]?.id ?? '');
  students.dodi = await studentAgent(dodi, 'Dodi');
});

describe('PKL check-in (PKL-02)', () => {
  it('records a check-in inside the radius for the industry supervisor, replayed with the same key', async () => {
    const k = key();
    const first = body('in');
    const res = await checkin(students.rizky, first, k).expect(201);
    const c = res.body as PklCheckin;
    expect(c).toMatchObject({ kind: 'in', schoolDate: today, distanceM: 40, reviewReasons: [], confirmStatus: 'pending', status: null });
    const again = await checkin(students.rizky, first, k).expect(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect((again.body as PklCheckin).id).toBe(c.id);
    const twice = await checkin(students.rizky, body('in')).expect(409);
    expect((twice.body as { details: { reason: string } }).details.reason).toBe('already_recorded');

    const [row] = await getDb().db.select().from(schema.pklCheckins).where(eq(schema.pklCheckins.id, c.id));
    expect(row?.latitude).toBe(Math.round(north(40).latitude * 10_000) / 10_000);
    expect(row?.accuracyM).toBe(12);
    const sessions = await getDb()
      .db.select()
      .from(schema.attendanceSessions)
      .where(and(eq(schema.attendanceSessions.schoolId, w.school), eq(schema.attendanceSessions.schoolDate, today), eq(schema.attendanceSessions.mode, 'pkl')));
    expect(sessions).toHaveLength(1);
  });

  it('sends a check-in outside the radius to the guru pembimbing', async () => {
    const c = (await checkin(students.sinta, body('in', north(500))).expect(201)).body as PklCheckin;
    expect(c).toMatchObject({ distanceM: 500, reviewReasons: ['outside_radius'], confirmStatus: 'needs_review' });
  });

  it('flags a wrong phone clock and a placement without industry supervisor', async () => {
    const c = (await checkin(students.bayu, body('in', north(10), new Date(Date.now() - 30 * 60_000))).expect(201)).body as PklCheckin;
    expect(c.reviewReasons).toEqual(['clock_skew', 'no_industry_mentor']);
    expect(c.confirmStatus).toBe('needs_review');
    const out = (await checkin(students.rizky, body('out', north(20))).expect(201)).body as PklCheckin;
    expect(out).toMatchObject({ kind: 'out', confirmStatus: null, reviewReasons: [] });
  });

  it('shows the student today without any coordinates', async () => {
    const me = (await students.rizky.get('/api/v1/pkl/me').set('X-School-Id', w.school).expect(200)).body as PklToday;
    expect(me.placement).toMatchObject({ partner: { name: 'PT Maju Jaya', radiusM: 150 }, schoolMentor: 'Pak pembimbing', industryMentor: 'Pak Mandor', hours: { startsAt: '00:00', endsAt: '23:59' } });
    expect(me.checkIn?.confirmStatus).toBe('pending');
    expect(me.checkOut?.kind).toBe('out');
    expect(JSON.stringify(me)).not.toMatch(/latitude|longitude/);
    const none = (await students.dodi.get('/api/v1/pkl/me').set('X-School-Id', w.school).expect(200)).body as PklToday;
    expect(none).toEqual({ date: today, placement: null, checkIn: null, checkOut: null });
  });

  it('refuses students without a placement, staff, a missing key and bad input', async () => {
    const no = await checkin(students.dodi, body('in')).expect(409);
    expect((no.body as { details: { reason: string } }).details.reason).toBe('no_placement');
    await checkin(w.agents.pembimbing, body('in')).expect(403);
    await checkin(students.sinta, body('out'), null).expect(400);
    await checkin(students.sinta, { ...body('out'), latitude: 91 }).expect(400);
    await checkin(students.sinta, { ...body('out'), deviceTime: 'kemarin' }).expect(400);
  });

  it('is off without pkl.enabled', async () => {
    const sma = await t.school('sma', 'SMA tanpa PKL');
    const u = await t.staff('Siswa SMA');
    await t.member(sma, u.id, 'siswa');
    const agent = t.agent();
    await signIn(agent, u.email).expect(200);
    const res = await checkin(agent, body('in'), key(), sma).expect(404);
    expect((res.body as { code: string }).code).toBe('CAPABILITY_DISABLED');
  });
});
