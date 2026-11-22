import { schema, sensitive } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { pushConsumers } from '../src/modules/notify';
import { withTenant } from '../src/shared/db';
import type { EventType } from '../src/shared/outbox';
import { runConsumer, type Consumer } from '../src/shared/outbox';
import { FakePushSender } from '../src/shared/push';
import { buildTestApp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

const today = new Date().toISOString().slice(0, 10);
let school: string;
let sender: FakePushSender;
let consumers: Map<string, Consumer>;
const staff: Record<string, { id: string; agent: Agent; endpoint: string }> = {};
let enrollment: string;

const sub = (n: number) => ({
  endpoint: `https://push.example.test/consumer/${n}-${uuidv7()}`,
  keys: { p256dh: Buffer.alloc(65, n).toString('base64url'), auth: Buffer.alloc(16, n).toString('base64url') },
});
const envelope = (type: EventType, payload: object) => ({ id: uuidv7(), schoolId: school, type, payload, traceId: null, occurredAt: new Date().toISOString() });
const run = (name: string, event: ReturnType<typeof envelope>) => {
  const c = consumers.get(name);
  if (!c) throw new Error(`no consumer ${name}`);
  return runConsumer(c, event);
};
const to = () => sender.sent.map((s) => s.target.endpoint);

async function member(key: string, n: number, enable = true, role: 'guru' | 'guru_bk' = 'guru') {
  const s = await t.staff(`Staf ${key}`);
  await t.member(school, s.id, role);
  const agent = t.agent();
  await signIn(agent, s.email).expect(200);
  const body = sub(n);
  if (enable) await agent.put('/api/v1/push/subscriptions').set('X-School-Id', school).set('Idempotency-Key', uuidv7()).send(body).expect(200);
  staff[key] = { id: s.id, agent, endpoint: body.endpoint };
}

async function leave(requestedBy: string | null, status: 'pending' | 'approved') {
  return withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [row] = await tx
      .insert(schema.leaveRequests)
      .values({ schoolId: school, enrollmentId: enrollment, kind: 'sakit', startsOn: today, endsOn: today, reason: sensitive('Demam'), status, requestedBy })
      .returning({ id: schema.leaveRequests.id });
    return row?.id ?? '';
  });
}

beforeAll(async () => {
  school = await t.school('sma', 'SMA Konsumen Push');
  await member('wali', 1);
  await member('host', 2);
  await member('off', 3, false);
  await member('guru', 4);
  await member('bk', 5, true, 'guru_bk');
  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: 'X-1', grade: 10, homeroomTeacherId: staff.wali?.id }).returning();
    const [student] = await tx.insert(schema.students).values({ schoolId: school, name: 'SITI RAHAYU' }).returning();
    const [e] = await tx.insert(schema.enrollments).values({ schoolId: school, studentId: student?.id ?? '', classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' }).returning();
    enrollment = e?.id ?? '';
  });
  sender = new FakePushSender();
  consumers = new Map(pushConsumers({ push: sender }).map((c) => [c.name, c]));
});

describe('staff push consumers (NTF-06)', () => {
  it('tells the named host, and only the host, that a guest waits', async () => {
    const event = envelope('gate.visitor_arrived', { visitorId: uuidv7(), hostUserId: staff.host?.id });
    expect(await run('notify_push_visitor_arrived', event)).toBe('handled');
    expect(to()).toEqual([staff.host?.endpoint]);
    expect(sender.sent[0]?.message).toMatchObject({ title: 'SMA Konsumen Push', body: 'Ada tamu menunggu Anda di gerbang.', url: '/' });
    // A redelivery sends nothing more.
    expect(await run('notify_push_visitor_arrived', event)).toBe('duplicate');
    expect(sender.sent).toHaveLength(1);
  });

  it('sends nothing, and does not fail, to a host who never enabled push', async () => {
    const before = sender.sent.length;
    expect(await run('notify_push_visitor_arrived', envelope('gate.visitor_arrived', { visitorId: uuidv7(), hostUserId: staff.off?.id }))).toBe('handled');
    expect(sender.sent).toHaveLength(before);
  });

  it('reminds the teacher of an unfilled session with a link to it', async () => {
    const sessionId = uuidv7();
    await run('notify_push_session_unfilled', envelope('attendance.session_unfilled', { sessionId, teacherId: staff.guru?.id }));
    const last = sender.sent.at(-1);
    expect(last?.target.endpoint).toBe(staff.guru?.endpoint);
    expect(last?.message).toMatchObject({ body: 'Presensi belum diisi. Ketuk untuk mengisi.', url: `/sesi/${sessionId}`, tag: `session:${sessionId}` });
  });

  it('asks the wali kelas to decide a pending izin, not for one already decided or their own', async () => {
    const before = sender.sent.length;
    const pending = await leave(null, 'pending');
    await run('notify_push_leave_requested', envelope('leave.requested', { leaveRequestId: pending }));
    expect(sender.sent).toHaveLength(before + 1);
    expect(sender.sent.at(-1)?.target.endpoint).toBe(staff.wali?.endpoint);
    expect(sender.sent.at(-1)?.message).toMatchObject({ body: 'Ada izin siswa yang menunggu persetujuan Anda.', url: '/izin', tag: 'leave-approval' });

    await run('notify_push_leave_requested', envelope('leave.requested', { leaveRequestId: await leave(staff.wali?.id ?? null, 'approved') }));
    await run('notify_push_leave_requested', envelope('leave.requested', { leaveRequestId: await leave(staff.wali?.id ?? null, 'pending') }));
    await run('notify_push_leave_requested', envelope('leave.requested', { leaveRequestId: await leave(null, 'approved') }));
    expect(sender.sent).toHaveLength(before + 1);
  });

  it('tells the wali kelas and guru BK, and nobody else, that an early warning waits', async () => {
    const warningId = uuidv7();
    await withTenant({ schoolId: school, userId: null }, (tx) =>
      tx.insert(schema.earlyWarnings).values({ id: warningId, schoolId: school, enrollmentId: enrollment, kind: 'consecutive_alpa', schoolDate: today, dates: [today] }),
    );
    const before = sender.sent.length;
    const event = envelope('ksw.early_warning_raised', { warningId });
    expect(await run('notify_push_early_warning', event)).toBe('handled');
    expect(sender.sent.slice(before).map((s) => s.target.endpoint).sort()).toEqual([staff.wali?.endpoint, staff.bk?.endpoint].sort());
    expect(sender.sent.at(-1)?.message).toMatchObject({ body: 'Ada peringatan dini kehadiran siswa. Ketuk untuk melihat.', url: '/peringatan-dini', tag: 'early-warning' });
    expect(await run('notify_push_early_warning', event)).toBe('duplicate');
    expect(sender.sent).toHaveLength(before + 2);
  });

  it('never puts a name or any personal data in a message', () => {
    expect(sender.sent.length).toBeGreaterThan(0);
    for (const { message } of sender.sent) {
      const text = JSON.stringify(message);
      expect(text).not.toMatch(/SITI|RAHAYU|Siti|Demam/);
      expect(text).not.toMatch(/\+62|@/);
    }
  });
});
