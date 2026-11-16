import type { ActionLinkContext, ActionLinkLeave, CardDeviceKeys, LeaveRequestList } from '@absah/contracts';
import { schema, sensitive } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attendanceConsumers, findSchool, generateForSchool } from '../src/modules/attendance';
import { notifyConsumers } from '../src/modules/notify';
import { getDb, withPlatform, withTenant } from '../src/shared/db';
import { FakeMessageSender } from '../src/shared/messaging';
import { runConsumer, type Consumer, type EventType } from '../src/shared/outbox';
import { schoolDate } from '../src/shared/school-date';
import { bindCards, gateSchool } from './gate-fixtures';
import { buildTestApp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

const today = schoolDate('Asia/Jakarta');
let school: string;
let enrollment: string;
let studentId: string;
let sessionId: string;
let wali: Agent;
let token: string;

const envelope = <T extends EventType>(type: T, payload: object) => ({ id: uuidv7(), schoolId: school, type, payload, traceId: null, occurredAt: new Date().toISOString() });
const link = (tk = token) => ({
  get: (path: string) => request(t.app).get(`/api/v1/links${path}`).set('Authorization', `Link ${tk}`),
  post: (path: string, body: object = {}) => request(t.app).post(`/api/v1/links${path}`).set('Authorization', `Link ${tk}`).send(body),
});
type ErrorBody = { code: string; details?: unknown };
const bodyOf = <T>(res: { body: unknown }) => res.body as T;
const deliver = (type: 'leave.approved', leaveRequestId: string) => {
  const consumer = attendanceConsumers().find((c) => c.event === type);
  if (!consumer) throw new Error(`no consumer for ${type}`);
  return runConsumer(consumer, envelope(type, { leaveRequestId }));
};
const sessionStatus = async () => {
  const [row] = await getDb()
    .db.select({ status: schema.attendanceRecords.status, source: schema.attendanceRecords.source })
    .from(schema.attendanceRecords)
    .where(and(eq(schema.attendanceRecords.sessionId, sessionId), eq(schema.attendanceRecords.enrollmentId, enrollment)));
  return row;
};

beforeAll(async () => {
  school = await t.school('sd', 'SD Tautan');
  await gateSchool(t, school);
  const w = await t.staff('Bu Wali Tautan');
  await t.member(school, w.id, 'guru');
  wali = t.agent();
  await signIn(wali, w.email).expect(200);
  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: '3A', grade: 3, homeroomTeacherId: w.id }).returning();
    const [student] = await tx.insert(schema.students).values({ schoolId: school, name: 'ANI LESTARI' }).returning();
    studentId = student?.id ?? '';
    const [e] = await tx.insert(schema.enrollments).values({ schoolId: school, studentId, classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' }).returning();
    enrollment = e?.id ?? '';
    const [g] = await tx.insert(schema.guardians).values({ schoolId: school, name: 'Ibu Ani', phone: sensitive('+6281200000011') }).returning();
    await tx.insert(schema.studentGuardians).values({ schoolId: school, studentId, guardianId: g?.id ?? '', relation: 'ibu', isPrimary: true });
  });
  const row = await withPlatform((tx) => findSchool(tx, school));
  if (!row) throw new Error('no school');
  await generateForSchool(row, today, new Date(), { force: true });
  const [session] = await getDb().db.select({ id: schema.attendanceSessions.id }).from(schema.attendanceSessions).where(eq(schema.attendanceSessions.schoolId, school));
  sessionId = session?.id ?? '';

  // The alpa message carries the link, as the parent receives it.
  const sender = new FakeMessageSender();
  // 10.00 WIB, outside the quiet hours, whenever the suite runs.
  const daytime = new Date(`${today}T03:00:00Z`);
  const consumers = new Map(notifyConsumers({ sender, appUrl: 'https://absah.test', now: () => daytime }).map((c) => [c.name, c]));
  await runConsumer(consumers.get('notify_absent_marked') as Consumer, envelope('attendance.absent_marked', { sessionId, enrollmentId: enrollment }));
  const [queued] = await getDb().db.select().from(schema.outboxEvents).where(and(eq(schema.outboxEvents.schoolId, school), eq(schema.outboxEvents.type, 'notification.queued')));
  await runConsumer(consumers.get('notify_send') as Consumer, { ...envelope('notification.queued', queued?.payload as object), id: queued?.id ?? '' });
  const url = sender.messages[0]?.params.at(-1) ?? '';
  expect(url).toMatch(/^https:\/\/absah\.test\/t#[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/);
  token = url.split('/t#')[1] ?? '';
});

describe('action links (ORT-01)', () => {
  it('shows the day by first name only and refuses unknown or tampered tokens', async () => {
    const res = await link().get('/context').expect(200);
    expect(res.body).toMatchObject({
      school: { name: 'SD Tautan' },
      student: { firstName: 'Ani', className: '3A' },
      today: { date: today, sessions: [{ mode: 'daily' }] },
      canRequestLeave: true,
      cardAvailable: true,
    });
    expect(JSON.stringify(res.body)).not.toContain('LESTARI');
    expect(res.headers['cache-control']).toBe('no-store');

    await link(`${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`).get('/context').expect(401);
    await link('bukan-token').get('/context').expect(401);
    await request(t.app).get('/api/v1/links/context').expect(401);
  });

  it('lets the parent ask izin once; the wali kelas approves and the session changes', async () => {
    // A bad request does not use up the link.
    await link().post('/leave', { kind: 'sakit', startsOn: today, endsOn: '2020-01-01', reason: 'Demam tinggi' }).expect(400);
    const created = bodyOf<ActionLinkLeave>(await link().post('/leave', { kind: 'sakit', startsOn: today, endsOn: today, reason: 'Demam tinggi' }).expect(201));
    expect(created).toMatchObject({ status: 'pending', kind: 'sakit' });
    const again = bodyOf<ErrorBody>(await link().post('/leave', { kind: 'izin', startsOn: today, endsOn: today, reason: 'Acara keluarga' }).expect(409));
    expect(again.details).toEqual({ reason: 'link_used' });
    expect((await link().get('/context').expect(200)).body).toMatchObject({ canRequestLeave: false, leaves: [{ id: created.id, status: 'pending' }] });

    const listed = bodyOf<LeaveRequestList>(await wali.get('/api/v1/leave-requests').set('X-School-Id', school).query({ status: 'pending' }).expect(200));
    expect(listed.items.map((l) => [l.id, l.requestedBy?.name])).toEqual([[created.id, 'Ibu Ani (tautan WhatsApp)']]);
    await wali.post(`/api/v1/leave-requests/${created.id}/decide`).set('X-School-Id', school).set('Idempotency-Key', uuidv7()).send({ approve: true }).expect(200);
    await deliver('leave.approved', created.id);

    expect(await sessionStatus()).toEqual({ status: 'S', source: 'leave' });
    expect(bodyOf<ActionLinkContext>(await link().get('/context').expect(200)).today.sessions).toEqual([{ mode: 'daily', status: 'S' }]);
  });

  it('shows the card on the link’s phone and only takes over another phone when asked', async () => {
    const first = bodyOf<CardDeviceKeys>(await link().post('/card').expect(200));
    expect(first.keys.length).toBeGreaterThan(0);
    expect(bodyOf<CardDeviceKeys>(await link().post('/card').expect(200)).deviceId).toBe(first.deviceId);

    // The student activates the card on their own phone: the link no longer owns it.
    await withTenant({ schoolId: school, userId: null }, (tx) => tx.delete(schema.cards).where(eq(schema.cards.studentId, studentId)));
    await bindCards(school, [studentId]);
    expect(bodyOf<ErrorBody>(await link().post('/card').expect(409)).details).toEqual({ reason: 'bound_elsewhere' });
    expect(bodyOf<CardDeviceKeys>(await link().post('/card', { replace: true }).expect(200)).deviceId).not.toBe(first.deviceId);
  });

  it('stops working after 7 days', async () => {
    await withTenant({ schoolId: school, userId: null }, (tx) => tx.update(schema.actionLinks).set({ expiresAt: new Date(Date.now() - 1000) }));
    expect(bodyOf<ErrorBody>(await link().get('/context').expect(410)).code).toBe('LINK_EXPIRED');
    await link().post('/card').expect(410);
  });
});
