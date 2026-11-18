import type { PklReviewList } from '@absah/contracts';
import { schema } from '@absah/db';
import { and, eq, sql } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { openPklSession } from '../src/modules/attendance';
import { notifyConsumers } from '../src/modules/notify';
import { remindMissingCheckins } from '../src/modules/pkl';
import { getDb, withTenant } from '../src/shared/db';
import { runConsumer } from '../src/shared/outbox';
import { addDays, schoolDate } from '../src/shared/school-date';
import { buildTestApp, testPhone, type Agent } from './harness';
import { DUDI_POINT, pklWorld, type PklWorld } from './pkl-fixtures';

const t = buildTestApp();
afterAll(() => t.cleanup());

const today = schoolDate('Asia/Jakarta');
let w: PklWorld;
const sessions: Record<string, string> = {};
const checkins: Record<string, string> = {};
const bayuPhone = testPhone();
const key = () => `pkl-rev-${uuidv7()}`;
const decide = (agent: Agent, sessionId: string, status: string) =>
  agent.post(`/api/v1/pkl/days/${sessionId}/decide`).set('X-School-Id', w.school).set('Idempotency-Key', key()).send({ status });
const queue = async (agent: Agent) => ((await agent.get('/api/v1/pkl/reviews').set('X-School-Id', w.school).expect(200)).body as PklReviewList).items;

async function record(sessionId: string) {
  const r = schema.attendanceRecords;
  const [row] = await getDb().db.select({ status: r.status, source: r.source, sourceRef: r.sourceRef }).from(r).where(eq(r.sessionId, sessionId));
  return row;
}

beforeAll(async () => {
  w = await pklWorld(t, 'SMK Tinjauan');
  const mentor = await t.staff('Mandor');
  await t.member(w.school, mentor.id, 'pembimbing_industri');
  const login = await t.parent(bayuPhone, 'BAYU SAPUTRA');
  await getDb().db.update(schema.students).set({ userId: login.id }).where(eq(schema.students.id, w.students.bayu));
  await withTenant({ schoolId: w.school, userId: null }, async (tx) => {
    // CV Sentosa works every day, so the reminder test does not depend on the weekday it runs.
    await tx.delete(schema.dudiWorkHours).where(eq(schema.dudiWorkHours.partnerId, w.partners.sentosa));
    await tx.insert(schema.dudiWorkHours).values([1, 2, 3, 4, 5, 6, 7].map((day) => ({ schoolId: w.school, partnerId: w.partners.sentosa, day, startsAt: '08:00', endsAt: '16:00' })));
    const period = { startsOn: addDays(today, -7), endsOn: addDays(today, 30) };
    const [rizky, sinta, bayu] = await tx
      .insert(schema.pklPlacements)
      .values([
        { schoolId: w.school, enrollmentId: w.enrollments.rizky, partnerId: w.partners.maju, schoolMentorId: w.users.pembimbing, industryMentorId: mentor.id, ...period },
        { schoolId: w.school, enrollmentId: w.enrollments.sinta, partnerId: w.partners.maju, schoolMentorId: w.users.pembimbing, industryMentorId: mentor.id, ...period },
        { schoolId: w.school, enrollmentId: w.enrollments.bayu, partnerId: w.partners.sentosa, schoolMentorId: w.users.guru, ...period },
      ])
      .returning();
    const open = (p: typeof rizky, days: number) => openPklSession(tx, w.school, p?.id ?? '', addDays(today, days));
    sessions.rizkyToday = await open(rizky, 0);
    sessions.rizkyMissing = await open(rizky, -2);
    sessions.rizkyConfirmed = await open(rizky, -1);
    sessions.sintaToday = await open(sinta, 0);
    sessions.sintaPending = await open(sinta, -3);
    sessions.bayuMissing = await open(bayu, -1);
    sessions.bayuToday = await open(bayu, 0);
    sessions.rizkyTomorrow = await open(rizky, 1);
    const ci = (p: typeof rizky, days: number, confirmStatus: 'needs_review' | 'disputed' | 'pending' | 'confirmed', extra: object = {}) => ({
      schoolId: w.school,
      placementId: p?.id ?? '',
      schoolDate: addDays(today, days),
      kind: 'in' as const,
      deviceTime: new Date(),
      ...DUDI_POINT,
      distanceM: 30,
      confirmStatus,
      ...extra,
    });
    const rows = await tx
      .insert(schema.pklCheckins)
      .values([
        ci(rizky, 0, 'needs_review', { distanceM: 820, accuracyM: 25, reviewReasons: ['outside_radius'] }),
        ci(sinta, 0, 'disputed', { disputeReason: 'Tidak masuk' }),
        ci(sinta, -3, 'pending'),
        ci(rizky, -1, 'confirmed'),
      ])
      .returning();
    checkins.rizkyToday = rows[0]?.id ?? '';
  });
});

describe('guru pembimbing review (PKL-02)', () => {
  it("lists the guru pembimbing's open queue: review, disputes, past days without check-in", async () => {
    const items = await queue(w.agents.pembimbing);
    expect(items.map((i) => [i.date, i.student.name, i.kind, i.checkIn?.confirmStatus ?? null])).toEqual([
      [addDays(today, -2), 'RIZKY PRATAMA', 'missing', null],
      [today, 'RIZKY PRATAMA', 'checkin', 'needs_review'],
      [today, 'SINTA DEWI', 'checkin', 'disputed'],
    ]);
    expect(items[1]?.checkIn).toMatchObject({ distanceM: 820, accuracyM: 25, reviewReasons: ['outside_radius'] });
    expect(items[2]?.checkIn?.disputeReason).toBe('Tidak masuk');
    const all = await queue(w.agents.humas);
    expect(all.map((i) => i.student.name)).toContain('BAYU SAPUTRA');
    expect(await queue(w.agents.kepsek)).toEqual([]);
  });

  it('decides a check-in in review, and deciding again replaces it', async () => {
    const res = await decide(w.agents.pembimbing, sessions.rizkyToday ?? '', 'H').expect(200);
    expect(res.body).toEqual({ sessionId: sessions.rizkyToday, status: 'H' });
    expect(await record(sessions.rizkyToday ?? '')).toEqual({ status: 'H', source: 'pkl_confirm', sourceRef: checkins.rizkyToday });
    await decide(w.agents.pembimbing, sessions.rizkyToday ?? '', 'S').expect(200);
    expect((await record(sessions.rizkyToday ?? ''))?.status).toBe('S');
    const [row] = await getDb().db.select().from(schema.pklCheckins).where(eq(schema.pklCheckins.id, checkins.rizkyToday ?? ''));
    expect(row).toMatchObject({ confirmStatus: 'decided', decidedStatus: 'S', decidedBy: w.users.pembimbing });
    expect((await queue(w.agents.pembimbing)).map((i) => i.sessionId)).not.toContain(sessions.rizkyToday);
  });

  it('decides a day without check-in; an alpa reaches the parents', async () => {
    await decide(w.agents.pembimbing, sessions.rizkyMissing ?? '', 'A').expect(200);
    expect(await record(sessions.rizkyMissing ?? '')).toEqual({ status: 'A', source: 'pkl_confirm', sourceRef: null });
    const events = await getDb().db.execute<{ n: number }>(
      sql`select count(*)::int as n from outbox_events where type = 'attendance.absent_marked' and payload->>'sessionId' = ${sessions.rizkyMissing ?? ''}`,
    );
    expect(events.rows[0]?.n).toBe(1);
  });

  it("leaves the industry supervisor's check-ins, other guru pembimbing's days and future days alone", async () => {
    expect(((await decide(w.agents.pembimbing, sessions.sintaPending ?? '', 'H').expect(409)).body as { details: { reason: string } }).details.reason).toBe('pending_industry');
    expect(((await decide(w.agents.pembimbing, sessions.rizkyConfirmed ?? '', 'A').expect(409)).body as { details: { reason: string } }).details.reason).toBe('confirmed');
    await decide(w.agents.pembimbing, sessions.bayuMissing ?? '', 'H').expect(404);
    await decide(w.agents.kepsek, sessions.bayuMissing ?? '', 'H').expect(404);
    await decide(w.agents.guru, sessions.bayuMissing ?? '', 'I').expect(200);
    await decide(w.agents.pembimbing, sessions.rizkyTomorrow ?? '', 'H').expect(400);
    await decide(w.agents.pembimbing, sessions.sintaToday ?? '', 'X').expect(400);
  });

  it('reminds a student without check-in once, on their own number (pkl.missing-checkin)', async () => {
    const outbox = async () =>
      (
        await getDb().db.execute<{ id: string }>(
          sql`select id from outbox_events where type = 'pkl.checkin_missing' and payload->>'sessionId' = ${sessions.bayuToday ?? ''}`,
        )
      ).rows;
    await remindMissingCheckins(new Date(`${today}T09:30:00+07:00`));
    expect(await outbox()).toHaveLength(0);
    await remindMissingCheckins(new Date(`${today}T10:05:00+07:00`));
    await remindMissingCheckins(new Date(`${today}T10:10:00+07:00`));
    expect(await outbox()).toHaveLength(1);
    // Rizky's day today has a check-in, Sinta's too: no reminder for them.
    const others = await getDb().db.execute<{ n: number }>(
      sql`select count(*)::int as n from outbox_events where type = 'pkl.checkin_missing' and payload->>'sessionId' in (${sessions.rizkyToday ?? ''}, ${sessions.sintaToday ?? ''})`,
    );
    expect(others.rows[0]?.n).toBe(0);

    const [consumer] = notifyConsumers({ sender: t.messageSender, appUrl: 'https://app.absah.test', now: () => new Date(`${today}T10:10:00+07:00`) }).filter((c) => c.name === 'notify_pkl_checkin_missing');
    if (!consumer) throw new Error('consumer missing');
    await runConsumer(consumer, { id: uuidv7(), schoolId: w.school, type: 'pkl.checkin_missing', payload: { sessionId: sessions.bayuToday ?? '' }, traceId: null, occurredAt: new Date().toISOString() });
    const [n] = await withTenant({ schoolId: w.school, userId: null }, (tx) =>
      tx.select().from(schema.notifications).where(and(eq(schema.notifications.templateCode, 'pkl_checkin_missing'))),
    );
    expect(n?.toPhone.reveal()).toBe(bayuPhone);
    expect(JSON.parse(n?.params.reveal() ?? '{}')).toEqual({ school: 'SMK Tinjauan', first_name: 'Bayu', partner: 'CV Sentosa', url: 'https://app.absah.test/portal/pkl' });
  });
});
