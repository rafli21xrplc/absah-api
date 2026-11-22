import { schema, sensitive } from '@absah/db';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { pushConsumers } from '../src/modules/notify';
import { getDb, withTenant } from '../src/shared/db';
import { runConsumer, type Consumer } from '../src/shared/outbox';
import { FakePushSender } from '../src/shared/push';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());
afterEach(() => vi.useRealTimers());

/** Monday 2026-11-23, 10.00 WIB. Only `Date` is pinned, so the HTTP stack keeps running. */
const NOW = '2026-11-23T03:00:00Z';
const pin = () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(NOW));
};

type Leave = { id: string; teacher: { id: string; name: string }; kind: string; startsOn: string; endsOn: string; reason: string; status: string; decidedBy: { name: string } | null; decisionNote: string | null; cancelledAt: string | null };

let school: string;
let off: string;
const agents: Record<string, Agent> = {};
const ids: Record<string, string> = {};
const A = (name: string): Agent => agents[name] as Agent;
const key = () => `tl-${uuidv7()}`;

const get = (agent: Agent, path: string, schoolId = school) => agent.get(`/api/v1${path}`).set('X-School-Id', schoolId);
const post = (agent: Agent, path: string, body: object = {}, schoolId = school, k = key()) => agent.post(`/api/v1${path}`).set('X-School-Id', schoolId).set('Idempotency-Key', k).send(body);
const ask = (agent: Agent, body: Partial<{ kind: string; startsOn: string; endsOn: string; reason: string }> = {}, schoolId = school) =>
  post(agent, '/teacher-leaves', { kind: 'sakit', startsOn: '2026-11-24', endsOn: '2026-11-25', reason: 'Demam tinggi', ...body }, schoolId);
const decide = (agent: Agent, id: string, body: object) => post(agent, `/teacher-leaves/${id}/decide`, body);
const list = async (agent: Agent, query = '') => ((await get(agent, `/teacher-leaves${query}`).expect(200)).body as { items: Leave[] }).items;

beforeAll(async () => {
  school = await t.school('smp', 'SMP Izin Guru');
  off = await t.school('smp', 'SMP Izin Guru Nonaktif');
  await getDb().db.insert(schema.schoolCapabilities).values({ schoolId: off, key: 'teacher.attendance', value: false });
  const roles = { guru: 'guru', other: 'guru', wali: 'wali_kelas', wakasek: 'wakasek', wakasek2: 'wakasek', kepsek: 'kepsek', admin: 'admin', uks: 'petugas_uks' } as const;
  for (const [name, role] of Object.entries(roles)) {
    const person = await t.staff(`Izin ${name}`);
    ids[name] = person.id;
    for (const s of [school, off]) await t.member(s, person.id, role);
    const agent = t.agent();
    await signIn(agent, person.email).expect(200);
    if (role === 'admin') await enableTotp(agent);
    agents[name] = agent;
  }
});

describe('POST /teacher-leaves (GRU-02)', () => {
  it('records a pending izin of the caller, with the reason readable to them', async () => {
    pin();
    const res = await ask(A('guru')).expect(201);
    expect(res.body).toMatchObject({ teacher: { id: ids['guru'] }, kind: 'sakit', startsOn: '2026-11-24', endsOn: '2026-11-25', reason: 'Demam tinggi', status: 'pending', decidedBy: null });
  });

  it('refuses an overlapping izin, but not an adjacent one, a rejected one, or another teacher', async () => {
    pin();
    const first = (await ask(A('other'), { startsOn: '2026-12-01', endsOn: '2026-12-03' }).expect(201)).body as Leave;
    const clash = await ask(A('other'), { startsOn: '2026-12-03', endsOn: '2026-12-04' }).expect(409);
    expect(clash.body).toMatchObject({ details: { reason: 'overlap' } });
    await ask(A('other'), { startsOn: '2026-12-04', endsOn: '2026-12-04' }).expect(201);
    await ask(A('wali'), { startsOn: '2026-12-01', endsOn: '2026-12-03' }).expect(201);
    await decide(A('wakasek'), first.id, { approve: false }).expect(200);
    await ask(A('other'), { startsOn: '2026-12-02', endsOn: '2026-12-02' }).expect(201);
  });

  it('keeps two simultaneous overlapping requests from both passing', async () => {
    pin();
    const results = await Promise.all([ask(A('wali'), { startsOn: '2026-12-10', endsOn: '2026-12-11' }), ask(A('wali'), { startsOn: '2026-12-11', endsOn: '2026-12-12' })]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
  });

  it('checks the dates like a student izin: order, 30 days, 7 days back', async () => {
    pin();
    await ask(A('guru'), { startsOn: '2026-12-20', endsOn: '2026-12-19' }).expect(400);
    await ask(A('guru'), { startsOn: '2026-12-20', endsOn: '2027-01-20' }).expect(400);
    await ask(A('guru'), { startsOn: '2026-11-15', endsOn: '2026-11-16' }).expect(400);
    await ask(A('guru'), { reason: '   ' }).expect(400);
    await ask(A('guru'), { kind: 'cuti' }).expect(400);
    await ask(A('guru'), { startsOn: '2026-11-16', endsOn: '2026-11-16' }).expect(201);
  });

  it('is for the staff who teach, and behind teacher.attendance', async () => {
    pin();
    for (const name of ['kepsek', 'admin', 'uks']) await ask(A(name)).expect(403);
    await ask(A('guru'), {}, off).expect(404);
    await t.agent().post('/api/v1/teacher-leaves').set('X-School-Id', school).send({}).expect(401);
  });
});

describe('GET /teacher-leaves (GRU-02)', () => {
  it('shows every teacher to the deciders and only their own to a teacher', async () => {
    pin();
    const all = await list(A('wakasek'), '?status=all');
    expect(new Set(all.map((l) => l.teacher.id))).toEqual(new Set([ids['guru'], ids['other'], ids['wali']]));
    for (const name of ['kepsek', 'admin']) expect((await list(A(name), '?status=all')).length).toBe(all.length);
    const mine = await list(A('guru'), '?status=all');
    expect(mine.length).toBeGreaterThan(0);
    expect(mine.every((l) => l.teacher.id === ids['guru'])).toBe(true);
    // mine=true narrows a decider to their own (none yet).
    expect(await list(A('wakasek'), '?status=all&mine=true')).toEqual([]);
  });

  it('filters by status, pending by default, newest start first', async () => {
    pin();
    expect((await list(A('wakasek'))).every((l) => l.status === 'pending')).toBe(true);
    const rejected = await list(A('wakasek'), '?status=rejected');
    expect(rejected.length).toBe(1);
    const all = await list(A('wakasek'), '?status=all');
    expect(all.map((l) => l.startsOn)).toEqual([...all.map((l) => l.startsOn)].sort().reverse());
  });

  it('is closed to roles that neither teach nor decide', async () => {
    pin();
    await get(A('uks'), '/teacher-leaves').expect(403);
    await get(A('guru'), '/teacher-leaves', off).expect(404);
  });
});

describe('POST /teacher-leaves/{id}/decide (GRU-02)', () => {
  it('lets the wakasek approve with a note, once', async () => {
    pin();
    const created = (await ask(A('guru'), { startsOn: '2026-12-15', endsOn: '2026-12-16' }).expect(201)).body as Leave;
    const res = await decide(A('wakasek'), created.id, { approve: true, note: 'Semoga lekas sembuh' }).expect(200);
    expect(res.body).toMatchObject({ status: 'approved', decidedBy: { name: 'Izin wakasek' }, decisionNote: 'Semoga lekas sembuh' });
    expect((await decide(A('wakasek2'), created.id, { approve: false }).expect(409)).body).toMatchObject({ details: { reason: 'already_decided' } });
  });

  it('lets kepsek and admin decide too, but never the teacher on their own izin or other roles', async () => {
    pin();
    const own = (await ask(A('wakasek'), { startsOn: '2026-12-17', endsOn: '2026-12-17' }).expect(201)).body as Leave;
    await decide(A('wakasek'), own.id, { approve: true }).expect(403);
    await decide(A('kepsek'), own.id, { approve: true }).expect(200);
    const another = (await ask(A('guru'), { startsOn: '2026-12-18', endsOn: '2026-12-18' }).expect(201)).body as Leave;
    await decide(A('guru'), another.id, { approve: true }).expect(403);
    await decide(A('wali'), another.id, { approve: true }).expect(403);
    await decide(A('uks'), another.id, { approve: true }).expect(403);
    await decide(A('admin'), another.id, { approve: false, note: 'Ada ujian' }).expect(200);
  });

  it('is 404 for an unknown izin and 400 for a note that is too long', async () => {
    pin();
    await decide(A('wakasek'), uuidv7(), { approve: true }).expect(404);
    const created = (await ask(A('guru'), { startsOn: '2026-12-19', endsOn: '2026-12-19' }).expect(201)).body as Leave;
    await decide(A('wakasek'), created.id, { approve: true, note: 'x'.repeat(301) }).expect(400);
  });

  it('lets two deciders at once settle it only once', async () => {
    pin();
    const created = (await ask(A('other'), { startsOn: '2026-12-21', endsOn: '2026-12-21' }).expect(201)).body as Leave;
    const results = await Promise.all([decide(A('wakasek'), created.id, { approve: true }), decide(A('wakasek2'), created.id, { approve: false })]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
  });
});

describe('POST /teacher-leaves/{id}/cancel (GRU-02)', () => {
  it('lets the teacher withdraw a pending or an approved izin that is not over', async () => {
    pin();
    const pending = (await ask(A('guru'), { startsOn: '2026-12-22', endsOn: '2026-12-22' }).expect(201)).body as Leave;
    const res = await post(A('guru'), `/teacher-leaves/${pending.id}/cancel`).expect(200);
    expect(res.body).toMatchObject({ status: 'cancelled', cancelledAt: expect.any(String) as string });
    const approved = (await ask(A('guru'), { startsOn: '2026-12-23', endsOn: '2026-12-23' }).expect(201)).body as Leave;
    await decide(A('wakasek'), approved.id, { approve: true }).expect(200);
    await post(A('guru'), `/teacher-leaves/${approved.id}/cancel`).expect(200);
    // Once cancelled it frees the dates.
    await ask(A('guru'), { startsOn: '2026-12-22', endsOn: '2026-12-23' }).expect(201);
  });

  it('refuses a rejected, an already cancelled and an over izin, and hides another teacher’s', async () => {
    pin();
    const rejected = (await list(A('wakasek'), '?status=rejected'))[0] as Leave;
    await post(A(rejected.teacher.id === ids['other'] ? 'other' : 'guru'), `/teacher-leaves/${rejected.id}/cancel`).expect(409);
    const cancelled = (await list(A('wakasek'), '?status=cancelled'))[0] as Leave;
    await post(A('guru'), `/teacher-leaves/${cancelled.id}/cancel`).expect(409);
    const over = (await ask(A('wali'), { startsOn: '2026-11-17', endsOn: '2026-11-18' }).expect(201)).body as Leave;
    await decide(A('wakasek'), over.id, { approve: true }).expect(200);
    expect((await post(A('wali'), `/teacher-leaves/${over.id}/cancel`).expect(409)).body).toMatchObject({ details: { reason: 'not_cancellable' } });
    const mine = (await ask(A('guru'), { startsOn: '2027-01-05', endsOn: '2027-01-05' }).expect(201)).body as Leave;
    await post(A('other'), `/teacher-leaves/${mine.id}/cancel`).expect(404);
    await post(A('wakasek'), `/teacher-leaves/${mine.id}/cancel`).expect(404);
  });
});

describe('what is stored and logged (GRU-02)', () => {
  it('keeps the reason and the decision note out of the audit log, with the decisions in', async () => {
    const logs = await getDb().db.select({ action: schema.auditLogs.action, after: schema.auditLogs.after }).from(schema.auditLogs).where(eq(schema.auditLogs.schoolId, school));
    const mine = logs.filter((l) => l.action.startsWith('teacher.leave_'));
    expect(new Set(mine.map((l) => l.action))).toEqual(new Set(['teacher.leave_requested', 'teacher.leave_approved', 'teacher.leave_rejected', 'teacher.leave_cancelled']));
    expect(JSON.stringify(mine)).not.toMatch(/Demam|Semoga|Ada ujian/);
  });
});

describe('push to the deciders and the teacher (GRU-02, NTF-06)', () => {
  const pushSchool = { id: '' };
  let sender: FakePushSender;
  let consumers: Map<string, Consumer>;
  const endpoints: Record<string, string> = {};
  const envelope = (type: 'teacher.leave_requested' | 'teacher.leave_decided', payload: object) => ({ id: uuidv7(), schoolId: pushSchool.id, type, payload, traceId: null, occurredAt: new Date().toISOString() });
  const run = (name: string, event: ReturnType<typeof envelope>) => runConsumer(consumers.get(name) as Consumer, event);
  const leaveRow = async (userId: string, status: 'pending' | 'approved') =>
    withTenant({ schoolId: pushSchool.id, userId: null }, async (tx) => {
      const [row] = await tx.insert(schema.teacherLeaves).values({ schoolId: pushSchool.id, userId, kind: 'izin', startsOn: '2026-12-01', endsOn: '2026-12-01', reason: sensitive('Urusan keluarga'), status }).returning({ id: schema.teacherLeaves.id });
      return row?.id ?? '';
    });
  const join = async (key: string, role: 'guru' | 'wakasek' | 'kepsek' | 'admin', n: number, schoolId = pushSchool.id) => {
    const person = await t.staff(`Push ${key}`);
    await t.member(schoolId, person.id, role);
    const agent = t.agent();
    await signIn(agent, person.email).expect(200);
    const endpoint = `https://push.example.test/tl/${n}-${uuidv7()}`;
    const body = { endpoint, keys: { p256dh: Buffer.alloc(65, n).toString('base64url'), auth: Buffer.alloc(16, n).toString('base64url') } };
    if (role !== 'admin') await agent.put('/api/v1/push/subscriptions').set('X-School-Id', schoolId).set('Idempotency-Key', uuidv7()).send(body).expect(200);
    endpoints[key] = endpoint;
    return person.id;
  };

  it('asks the wakasek, never the teacher who asked, and says nothing personal', async () => {
    pushSchool.id = await t.school('smp', 'SMP Push Izin Guru');
    const teacher = await join('teacher', 'guru', 1);
    await join('wakasekA', 'wakasek', 2);
    await join('wakasekB', 'wakasek', 3);
    await join('kepsekOnly', 'kepsek', 4);
    sender = new FakePushSender();
    consumers = new Map(pushConsumers({ push: sender }).map((c) => [c.name, c]));
    const id = await leaveRow(teacher, 'pending');
    const event = envelope('teacher.leave_requested', { teacherLeaveId: id });
    expect(await run('notify_push_teacher_leave_requested', event)).toBe('handled');
    expect(sender.sent.map((s) => s.target.endpoint).sort()).toEqual([endpoints['wakasekA'], endpoints['wakasekB']].sort());
    expect(sender.sent[0]?.message).toMatchObject({ body: 'Ada izin guru yang menunggu persetujuan Anda.', url: '/izin-guru', tag: 'teacher-leave-approval' });
    expect(JSON.stringify(sender.sent.map((s) => s.message))).not.toMatch(/Urusan|keluarga|Push teacher/);
    expect(await run('notify_push_teacher_leave_requested', event)).toBe('duplicate');
    expect(sender.sent).toHaveLength(2);
  });

  it('does not ask again for an izin that is already decided', async () => {
    const before = sender.sent.length;
    const teacher = await join('teacher2', 'guru', 5);
    await run('notify_push_teacher_leave_requested', envelope('teacher.leave_requested', { teacherLeaveId: await leaveRow(teacher, 'approved') }));
    expect(sender.sent).toHaveLength(before);
  });

  it('falls back to the kepsek when the school has no wakasek, and a wakasek with an izin of their own is not asked about it', async () => {
    const lone = await t.school('smp', 'SMP Tanpa Wakasek');
    const kepsek = await join('loneKepsek', 'kepsek', 6, lone);
    const teacher = await join('loneTeacher', 'guru', 7, lone);
    const loneId = await withTenant({ schoolId: lone, userId: null }, async (tx) => {
      const [row] = await tx.insert(schema.teacherLeaves).values({ schoolId: lone, userId: teacher, kind: 'izin', startsOn: '2026-12-01', endsOn: '2026-12-01', reason: sensitive('x') }).returning({ id: schema.teacherLeaves.id });
      return row?.id ?? '';
    });
    const before = sender.sent.length;
    await runConsumer(consumers.get('notify_push_teacher_leave_requested') as Consumer, { id: uuidv7(), schoolId: lone, type: 'teacher.leave_requested', payload: { teacherLeaveId: loneId }, traceId: null, occurredAt: new Date().toISOString() });
    expect(sender.sent.slice(before).map((s) => s.target.endpoint)).toEqual([endpoints['loneKepsek']]);
    expect(kepsek).toBeTruthy();
  });

  it('tells the teacher that the izin was decided, without saying which way', async () => {
    const teacher = await join('teacher3', 'guru', 8);
    const id = await leaveRow(teacher, 'approved');
    const before = sender.sent.length;
    expect(await run('notify_push_teacher_leave_decided', envelope('teacher.leave_decided', { teacherLeaveId: id, approved: true }))).toBe('handled');
    const last = sender.sent.at(-1);
    expect(sender.sent).toHaveLength(before + 1);
    expect(last?.target.endpoint).toBe(endpoints['teacher3']);
    expect(last?.message).toMatchObject({ body: 'Izin Anda sudah diputuskan. Ketuk untuk melihat.', url: '/izin-guru' });
    expect(JSON.stringify(last?.message)).not.toMatch(/disetujui|ditolak|approved/i);
  });
});
