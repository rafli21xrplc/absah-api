import type { PklPlacement, PklPlacementList } from '@absah/contracts';
import { schema } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expireIndustryMentors } from '../src/modules/pkl';
import { notifyConsumers } from '../src/modules/notify';
import { getDb, withTenant } from '../src/shared/db';
import { runConsumer } from '../src/shared/outbox';
import { addDays, schoolDate } from '../src/shared/school-date';
import { buildTestApp, testPhone, type Agent } from './harness';
import { pklWorld, type PklWorld } from './pkl-fixtures';

const t = buildTestApp();
afterAll(() => t.cleanup());

let w: PklWorld;
const today = schoolDate('Asia/Jakarta');
const ends = addDays(today, 60);
const key = () => `pkl-pl-${uuidv7()}`;
const create = (agent: Agent, body: object, k = key()) => agent.post('/api/v1/pkl/placements').set('X-School-Id', w.school).set('Idempotency-Key', k).send(body);
const patch = (id: string, body: object) => w.agents.humas.patch(`/api/v1/pkl/placements/${id}`).set('X-School-Id', w.school).set('Idempotency-Key', key()).send(body);
const mentorPhone = testPhone();

async function mentorMembership(phone: string) {
  const [u] = await getDb().db.select({ id: schema.user.id }).from(schema.user).where(eq(schema.user.phoneNumber, phone));
  if (!u) return { userId: undefined, status: undefined };
  const [m] = await getDb()
    .db.select({ status: schema.memberships.status })
    .from(schema.memberships)
    .where(and(eq(schema.memberships.userId, u.id), eq(schema.memberships.schoolId, w.school), eq(schema.memberships.role, 'pembimbing_industri')));
  return { userId: u.id, status: m?.status };
}

beforeAll(async () => {
  w = await pklWorld(t);
});

describe('PKL placements (PKL-01)', () => {
  let batch: PklPlacement[];

  it('places students at a DUDI and activates the industry supervisor without an invitation', async () => {
    const body = {
      enrollmentIds: [w.enrollments.rizky, w.enrollments.sinta],
      partnerId: w.partners.maju,
      startsOn: today,
      endsOn: ends,
      schoolMentorId: w.users.pembimbing,
      industryMentor: { name: 'Pak Mandor', phoneNumber: mentorPhone },
    };
    const k = key();
    const res = await create(w.agents.humas, body, k).expect(201);
    batch = (res.body as PklPlacementList).items;
    expect(batch.map((p) => p.student.name)).toEqual(['RIZKY PRATAMA', 'SINTA DEWI']);
    expect(batch[0]).toMatchObject({
      partner: { id: w.partners.maju, name: 'PT Maju Jaya' },
      status: 'active',
      current: true,
      schoolMentor: { id: w.users.pembimbing, name: 'Pak pembimbing' },
      industryMentor: { name: 'Pak Mandor', phone: `${mentorPhone.slice(0, 6)}****${mentorPhone.slice(-4)}` },
    });
    const again = await create(w.agents.humas, body, k).expect(201);
    expect(again.headers['idempotent-replayed']).toBe('true');
    expect((await mentorMembership(mentorPhone)).status).toBe('active');
  });

  it('sends the supervisor one WhatsApp with the /dudi link and the student count', async () => {
    const { userId } = await mentorMembership(mentorPhone);
    const [notify] = notifyConsumers({ sender: t.messageSender, appUrl: 'https://app.absah.test', now: () => new Date(`${today}T10:00:00+07:00`) }).filter((c) => c.name === 'notify_pkl_mentor_assigned');
    const event = () => ({ id: uuidv7(), schoolId: w.school, type: 'pkl.mentor_assigned' as const, payload: { userId: userId ?? '' }, traceId: null, occurredAt: new Date().toISOString() });
    if (!notify) throw new Error('consumer missing');
    await runConsumer(notify, event());
    await runConsumer(notify, event());
    const rows = await withTenant({ schoolId: w.school, userId: null }, (tx) => tx.select().from(schema.notifications).where(eq(schema.notifications.templateCode, 'pkl_mentor_assigned')));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.toPhone.reveal()).toBe(mentorPhone);
    expect(JSON.parse(rows[0]?.params.reveal() ?? '{}')).toMatchObject({ school: 'SMK Absah PKL', count: '2', url: 'https://app.absah.test/dudi' });
  });

  it('refuses overlaps, a past period, non-staff mentors and a student login as supervisor', async () => {
    const base = { partnerId: w.partners.sentosa, startsOn: addDays(today, 30), endsOn: addDays(today, 90), schoolMentorId: w.users.pembimbing };
    const overlap = await create(w.agents.humas, { ...base, enrollmentIds: [w.enrollments.bayu, w.enrollments.sinta] }).expect(409);
    expect((overlap.body as { details: unknown }).details).toEqual({ reason: 'overlap', enrollmentIds: [w.enrollments.sinta] });
    await create(w.agents.humas, { ...base, enrollmentIds: [w.enrollments.bayu], startsOn: '2026-08-01', endsOn: '2026-09-01' }).expect(400);
    await create(w.agents.humas, { ...base, enrollmentIds: [w.enrollments.bayu], schoolMentorId: (await mentorMembership(mentorPhone)).userId }).expect(400);
    await create(w.agents.humas, { ...base, enrollmentIds: [w.enrollments.bayu], endsOn: addDays(today, 400) }).expect(400);

    const studentPhone = testPhone();
    const login = await t.parent(studentPhone, 'BAYU SAPUTRA');
    await getDb().db.update(schema.students).set({ userId: login.id }).where(eq(schema.students.id, w.students.bayu));
    const taken = await create(w.agents.humas, { ...base, enrollmentIds: [w.enrollments.bayu], industryMentor: { name: 'Bayu', phoneNumber: studentPhone } }).expect(409);
    expect((taken.body as { details: { reason: string } }).details.reason).toBe('phone_student');
  });

  it('shows a guru pembimbing only their placements; others may not write', async () => {
    await create(w.agents.guru, { enrollmentIds: [w.enrollments.bayu], partnerId: w.partners.sentosa, startsOn: today, endsOn: ends, schoolMentorId: w.users.guru }).expect(403);
    const mine = (await w.agents.pembimbing.get('/api/v1/pkl/placements').set('X-School-Id', w.school).expect(200)).body as PklPlacementList;
    expect(mine.items).toHaveLength(2);
    const none = (await w.agents.guru.get('/api/v1/pkl/placements').set('X-School-Id', w.school).expect(200)).body as PklPlacementList;
    expect(none.items).toEqual([]);
    const all = (await w.agents.kepsek.get(`/api/v1/pkl/placements?partnerId=${w.partners.maju}`).set('X-School-Id', w.school).expect(200)).body as PklPlacementList;
    expect(all.items).toHaveLength(2);
  });

  it('moves access when the industry supervisor changes and on cancel', async () => {
    const [rizky, sinta] = batch;
    const second = testPhone();
    const changed = (await patch(rizky?.id ?? '', { industryMentor: { name: 'Bu Supervisor', phoneNumber: second } }).expect(200)).body as PklPlacement;
    expect(changed.industryMentor?.name).toBe('Bu Supervisor');
    expect((await mentorMembership(mentorPhone)).status).toBe('active'); // still has Sinta
    expect((await mentorMembership(second)).status).toBe('active');

    await w.agents.humas.post(`/api/v1/pkl/placements/${sinta?.id ?? ''}/cancel`).set('X-School-Id', w.school).set('Idempotency-Key', key()).expect(200);
    expect((await mentorMembership(mentorPhone)).status).toBe('suspended');
    const again = await w.agents.humas.post(`/api/v1/pkl/placements/${sinta?.id ?? ''}/cancel`).set('X-School-Id', w.school).set('Idempotency-Key', key()).expect(200);
    expect((again.body as PklPlacement).status).toBe('cancelled');
    await patch(sinta?.id ?? '', { endsOn: addDays(today, 10) }).expect(409);
    await patch(rizky?.id ?? '', { endsOn: addDays(today, -400) }).expect(400);
  });

  it('suspends supervisors whose placements ended (pkl.expire-mentors)', async () => {
    // Other test files may have schools with supervisors too, so check this school's rows only.
    const status = async () => {
      const list = (await w.agents.humas.get('/api/v1/pkl/placements').set('X-School-Id', w.school).expect(200)).body as PklPlacementList;
      const mentorId = list.items[0]?.industryMentor?.id ?? '';
      const [m] = await getDb().db.select({ status: schema.memberships.status }).from(schema.memberships).where(and(eq(schema.memberships.userId, mentorId), eq(schema.memberships.schoolId, w.school)));
      return m?.status;
    };
    await expireIndustryMentors(new Date(`${ends}T23:00:00+07:00`));
    expect(await status()).toBe('active');
    await expireIndustryMentors(new Date(`${addDays(ends, 1)}T00:10:00+07:00`));
    expect(await status()).toBe('suspended');
  });

  it('is off without pkl.enabled', async () => {
    const sma = await t.school('sma', 'SMA tanpa PKL');
    await t.member(sma, w.users.humas, 'humas_pkl');
    const res = await w.agents.humas.get('/api/v1/pkl/placements').set('X-School-Id', sma).expect(404);
    expect((res.body as { code: string }).code).toBe('CAPABILITY_DISABLED');
  });
});
