import { schema, sensitive } from '@absah/db';
import { and, eq } from 'drizzle-orm';
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

/** Monday 2026-11-23, 06.00 WIB: before anyone teaches. Only `Date` is pinned. */
const DATE = '2026-11-23';
const pin = () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-22T23:00:00Z'));
};

type Item = {
  session: { id: string; mode: string; owner: { name: string }; period: { number: number; startsAt: string; endsAt: string } | null; subject: { name: string } | null };
  absentTeacher: { id: string; name: string };
  leaveKind: string | null;
  substitute: { id: string; name: string } | null;
  status: 'needed' | 'assigned';
};
type Candidate = { userId: string; name: string; checkedIn: boolean; sameSubject: boolean; substitutionsThisMonth: number };

let smp: string;
let sd: string;
let off: string;
const ids: Record<string, string> = {};
const agents: Record<string, Agent> = {};
const sessions: Record<string, string> = {};
const A = (name: string): Agent => agents[name] as Agent;
const key = () => `sb-${uuidv7()}`;

const get = (agent: Agent, path: string, schoolId = smp) => agent.get(`/api/v1${path}`).set('X-School-Id', schoolId);
const assign = (agent: Agent, sessionId: string, substituteId: string, schoolId = smp) =>
  agent.post('/api/v1/substitutions').set('X-School-Id', schoolId).set('Idempotency-Key', key()).send({ sessionId, substituteId });
const items = async (agent: Agent, date = DATE, schoolId = smp) => ((await get(agent, `/substitutions?date=${date}`, schoolId).expect(200)).body as { items: Item[] }).items;
const candidates = async (agent: Agent, sessionId: string) => ((await get(agent, `/substitutions/candidates?sessionId=${sessionId}`).expect(200)).body as { items: Candidate[] }).items;
const reasonOf = (res: { body: unknown }) => (res.body as { details?: { reason?: string } }).details?.reason;

async function person(name: string, role: 'guru' | 'wali_kelas' | 'wakasek' | 'piket' | 'kepsek' | 'admin' | 'petugas_uks', schoolIds: string[]) {
  const p = await t.staff(`Pengganti ${name}`);
  ids[name] = p.id;
  for (const s of schoolIds) await t.member(s, p.id, role);
  const agent = t.agent();
  await signIn(agent, p.email).expect(200);
  if (role === 'admin') await enableTotp(agent);
  agents[name] = agent;
}

async function leave(schoolId: string, userId: string, startsOn = DATE, endsOn = DATE) {
  await withTenant({ schoolId, userId: null }, (tx) => tx.insert(schema.teacherLeaves).values({ schoolId, userId, kind: 'sakit', startsOn, endsOn, reason: sensitive('Demam'), status: 'approved' }));
}

beforeAll(async () => {
  smp = await t.school('smp', 'SMP Guru Pengganti');
  sd = await t.school('sd', 'SD Guru Pengganti');
  off = await t.school('smp', 'SMP Pengganti Nonaktif');
  await getDb().db.insert(schema.schoolCapabilities).values({ schoolId: off, key: 'teacher.attendance', value: false });
  for (const [name, role] of [['absent', 'guru'], ['absentB', 'guru'], ['busy', 'guru'], ['math', 'guru'], ['science', 'guru'], ['onLeave', 'guru'], ['free', 'guru'], ['c1', 'guru'], ['c2', 'guru']] as const) await person(name, role, [smp]);
  await person('piket', 'piket', [smp, sd, off]);
  await person('wakasek', 'wakasek', [smp, sd, off]);
  await person('kepsek', 'kepsek', [smp, sd]);
  await person('admin', 'admin', [smp, off]);
  await person('uks', 'petugas_uks', [smp]);
  await person('plain', 'guru', [smp, off]);

  await withTenant({ schoolId: smp, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: smp, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const yearId = year?.id ?? '';
    const classes = await tx.insert(schema.classes).values(['8A', '8B', '8C'].map((name) => ({ schoolId: smp, academicYearId: yearId, name, grade: 8 }))).returning();
    const cls = Object.fromEntries(classes.map((c) => [c.name, c.id]));
    const [mat, ipa] = await tx.insert(schema.subjects).values([{ schoolId: smp, name: 'Matematika' }, { schoolId: smp, name: 'IPA' }]).returning();
    await tx.insert(schema.schedulePeriods).values([
      { schoolId: smp, day: 1, number: 1, startsAt: '07:00', endsAt: '07:40' },
      { schoolId: smp, day: 1, number: 2, startsAt: '07:40', endsAt: '08:20' },
      { schoolId: smp, day: 1, number: 3, startsAt: '08:20', endsAt: '09:00' },
    ]);
    const slot = (classId: string | undefined, period: number, subjectId: string | undefined, teacher: string | undefined) => ({ schoolId: smp, academicYearId: yearId, ownerType: 'class' as const, ownerId: classId ?? '', day: 1, period, subjectId: subjectId ?? '', teacherId: teacher ?? null });
    const rows = await tx
      .insert(schema.scheduleSlots)
      .values([
        slot(cls['8A'], 1, mat?.id, ids['absent']), // A: Matematika 8A p1
        slot(cls['8B'], 2, mat?.id, ids['absent']), // A: Matematika 8B p2
        slot(cls['8C'], 1, mat?.id, ids['absentB']), // B: Matematika 8C p1 (same period as A's first)
        slot(cls['8B'], 1, ipa?.id, ids['busy']), // busy teacher has p1
        slot(cls['8A'], 3, mat?.id, ids['math']), // math teacher: p3
        slot(cls['8B'], 3, ipa?.id, ids['science']), // science teacher: p3
        slot(cls['8C'], 3, mat?.id, ids['c1']),
        slot(cls['8A'], 2, ipa?.id, ids['c2']),
      ])
      .returning();
    const by = (period: number, classId: string | undefined) => rows.find((r) => r.period === period && r.ownerId === classId)?.id ?? '';
    const make = async (label: string, slotId: string, classId: string | undefined, teacherId: string | undefined) => {
      const [row] = await tx.insert(schema.attendanceSessions).values({ schoolId: smp, schoolDate: DATE, mode: 'per_period', ownerType: 'class', ownerId: classId ?? '', slotId, teacherId: teacherId ?? null }).returning();
      sessions[label] = row?.id ?? '';
    };
    await make('A-p1-8A', by(1, cls['8A']), cls['8A'], ids['absent']);
    await make('A-p2-8B', by(2, cls['8B']), cls['8B'], ids['absent']);
    await make('B-p1-8C', by(1, cls['8C']), cls['8C'], ids['absentB']);
    await make('busy-p1-8B', by(1, cls['8B']), cls['8B'], ids['busy']);
    await make('c1-p3-8C', by(3, cls['8C']), cls['8C'], ids['c1']);
    await make('c2-p2-8A', by(2, cls['8A']), cls['8A'], ids['c2']);
    await tx.insert(schema.teacherAttendance).values({ schoolId: smp, userId: ids['science'] ?? '', schoolDate: DATE, checkedInAt: new Date('2026-11-22T23:30:00Z'), source: 'app' });
  });
  await leave(smp, ids['absent'] ?? '', DATE, '2026-11-24');
  await leave(smp, ids['absentB'] ?? '');
  await leave(smp, ids['onLeave'] ?? '');
  await leave(smp, ids['c1'] ?? '');
  await leave(smp, ids['c2'] ?? '');
});

describe('GET /substitutions (GRU-03)', () => {
  it('lists the sessions of teachers on approved izin, in lesson order, with time and subject', async () => {
    pin();
    const list = await items(A('wakasek'));
    const mine = list.filter((i) => [sessions['A-p1-8A'], sessions['A-p2-8B'], sessions['B-p1-8C']].includes(i.session.id));
    expect(mine.map((i) => [i.session.owner.name, i.session.period?.number, i.status])).toEqual(expect.arrayContaining([['8A', 1, 'needed'], ['8B', 2, 'needed'], ['8C', 1, 'needed']]));
    const first = list.find((i) => i.session.id === sessions['A-p1-8A']);
    expect(first).toMatchObject({ absentTeacher: { id: ids['absent'] }, leaveKind: 'sakit', substitute: null, session: { period: { startsAt: '07:00', endsAt: '07:40' }, subject: { name: 'Matematika' } } });
    const periods = list.map((i) => i.session.period?.number ?? 0);
    expect(periods).toEqual([...periods].sort((a, b) => a - b));
  });

  it('does not list a session whose teacher is not on izin, nor a day without izin', async () => {
    pin();
    expect((await items(A('wakasek'))).map((i) => i.session.id)).not.toContain(sessions['busy-p1-8B']);
    expect(await items(A('wakasek'), '2026-11-25')).toEqual([]);
  });

  it('is read by wakasek, piket, kepsek and admin, not by teachers, and is behind the capability', async () => {
    pin();
    for (const name of ['wakasek', 'piket', 'kepsek', 'admin']) await get(A(name), `/substitutions?date=${DATE}`).expect(200);
    for (const name of ['plain', 'uks']) await get(A(name), `/substitutions?date=${DATE}`).expect(403);
    await get(A('wakasek'), `/substitutions?date=${DATE}`, off).expect(404);
    await t.agent().get(`/api/v1/substitutions?date=${DATE}`).set('X-School-Id', smp).expect(401);
  });
});

describe('GET /substitutions/candidates (GRU-03)', () => {
  it('suggests free teachers: not the absent one, nobody with a lesson then, nobody on izin', async () => {
    pin();
    const names = (await candidates(A('wakasek'), sessions['A-p1-8A'] ?? '')).map((c) => c.userId);
    expect(names).not.toContain(ids['absent']);
    expect(names).not.toContain(ids['busy']); // teaches IPA 8B in period 1
    expect(names).not.toContain(ids['absentB']);
    expect(names).not.toContain(ids['onLeave']);
    expect(names).toEqual(expect.arrayContaining([ids['math'], ids['science'], ids['free'], ids['piket'], ids['wakasek']]));
    expect(names).not.toContain(ids['kepsek']);
    expect(names).not.toContain(ids['uks']);
  });

  it('ranks those who checked in first, then the same subject, and says why', async () => {
    pin();
    const list = await candidates(A('piket'), sessions['A-p1-8A'] ?? '');
    expect(list[0]).toMatchObject({ userId: ids['science'], checkedIn: true });
    const math = list.find((c) => c.userId === ids['math']);
    const free = list.find((c) => c.userId === ids['free']);
    expect(math).toMatchObject({ sameSubject: true, checkedIn: false });
    expect(free).toMatchObject({ sameSubject: false });
    expect(list.findIndex((c) => c.userId === ids['math'])).toBeLessThan(list.findIndex((c) => c.userId === ids['free']));
  });

  it('refuses a session that needs no substitute, and an unknown one', async () => {
    pin();
    const res = await get(A('wakasek'), `/substitutions/candidates?sessionId=${sessions['busy-p1-8B']}`).expect(409);
    expect(reasonOf(res)).toBe('not_needed');
    await get(A('wakasek'), `/substitutions/candidates?sessionId=${uuidv7()}`).expect(404);
    await get(A('plain'), `/substitutions/candidates?sessionId=${sessions['A-p1-8A']}`).expect(403);
  });
});

describe('POST /substitutions (GRU-03)', () => {
  it('moves the session to the substitute, who can fill it, while the other session still needs one', async () => {
    pin();
    const res = await assign(A('wakasek'), sessions['A-p1-8A'] ?? '', ids['math'] ?? '').expect(201);
    expect(res.body).toMatchObject({ status: 'assigned', absentTeacher: { id: ids['absent'] }, substitute: { id: ids['math'] } });
    const mine = await A('math').get('/api/v1/attendance/today').set('X-School-Id', smp).expect(200);
    expect((mine.body as { sessions: { id: string; canFill: boolean }[] }).sessions).toEqual(expect.arrayContaining([expect.objectContaining({ id: sessions['A-p1-8A'], canFill: true })]));
    const theirs = await A('absent').get('/api/v1/attendance/today').set('X-School-Id', smp).expect(200);
    expect((theirs.body as { sessions: { id: string }[] }).sessions.map((s) => s.id)).not.toContain(sessions['A-p1-8A']);
    const list = await items(A('piket'));
    expect(list.find((i) => i.session.id === sessions['A-p1-8A'])).toMatchObject({ status: 'assigned', substitute: { name: 'Pengganti math' } });
    expect(list.find((i) => i.session.id === sessions['A-p2-8B'])).toMatchObject({ status: 'needed' });
  });

  it('refuses someone who already holds a lesson at that time, including one a substitution gave them', async () => {
    pin();
    expect(reasonOf(await assign(A('wakasek'), sessions['B-p1-8C'] ?? '', ids['busy'] ?? '').expect(409))).toBe('busy');
    // math took 8A p1 above, so 8C p1 clashes with that.
    expect(reasonOf(await assign(A('wakasek'), sessions['B-p1-8C'] ?? '', ids['math'] ?? '').expect(409))).toBe('busy');
    expect((await get(A('wakasek'), `/substitutions/candidates?sessionId=${sessions['B-p1-8C']}`).expect(200)).body).toMatchObject({ items: expect.not.arrayContaining([expect.objectContaining({ userId: ids['math'] })]) as unknown[] });
  });

  it('refuses a teacher on izin, the absent teacher, and someone who is not a teacher', async () => {
    pin();
    expect(reasonOf(await assign(A('piket'), sessions['A-p2-8B'] ?? '', ids['onLeave'] ?? '').expect(409))).toBe('on_leave');
    expect(reasonOf(await assign(A('piket'), sessions['A-p2-8B'] ?? '', ids['absent'] ?? '').expect(409))).toBe('is_absent_teacher');
    expect(reasonOf(await assign(A('piket'), sessions['A-p2-8B'] ?? '', ids['kepsek'] ?? '').expect(409))).toBe('not_a_teacher');
  });

  it('lets the piket and admin assign too, but not kepsek, teachers or other roles', async () => {
    pin();
    await assign(A('kepsek'), sessions['A-p2-8B'] ?? '', ids['free'] ?? '').expect(403);
    await assign(A('plain'), sessions['A-p2-8B'] ?? '', ids['free'] ?? '').expect(403);
    await assign(A('uks'), sessions['A-p2-8B'] ?? '', ids['free'] ?? '').expect(403);
    await assign(A('piket'), sessions['A-p2-8B'] ?? '', ids['free'] ?? '').expect(201);
    await assign(A('admin'), sessions['B-p1-8C'] ?? '', ids['free'] ?? '').expect(201);
  });

  it('changes the substitute without losing the history, and refuses the same one twice', async () => {
    pin();
    await assign(A('wakasek'), sessions['A-p1-8A'] ?? '', ids['science'] ?? '').expect(201);
    expect(reasonOf(await assign(A('wakasek'), sessions['A-p1-8A'] ?? '', ids['science'] ?? '').expect(409))).toBe('already_assigned');
    const list = await items(A('wakasek'));
    expect(list.find((i) => i.session.id === sessions['A-p1-8A'])).toMatchObject({ absentTeacher: { id: ids['absent'] }, substitute: { id: ids['science'] }, status: 'assigned' });
    const history = await getDb().db.select().from(schema.sessionSubstitutions).where(eq(schema.sessionSubstitutions.sessionId, sessions['A-p1-8A'] ?? '')).orderBy(schema.sessionSubstitutions.createdAt);
    expect(history.map((h) => [h.fromTeacherId, h.substituteId])).toEqual([[ids['absent'], ids['math']], [ids['math'], ids['science']]]);
    // The one who was replaced is free again.
    await assign(A('wakasek'), sessions['A-p2-8B'] ?? '', ids['math'] ?? '').expect(201);
  });

  it('refuses a session nobody has to replace, one that is over, and an unknown one', async () => {
    pin();
    expect(reasonOf(await assign(A('wakasek'), sessions['busy-p1-8B'] ?? '', ids['free'] ?? '').expect(409))).toBe('not_needed');
    await withTenant({ schoolId: smp, userId: null }, (tx) => tx.update(schema.attendanceSessions).set({ status: 'submitted' }).where(eq(schema.attendanceSessions.id, sessions['c1-p3-8C'] ?? '')));
    expect(reasonOf(await assign(A('wakasek'), sessions['c1-p3-8C'] ?? '', ids['free'] ?? '').expect(409))).toBe('session_closed');
    await assign(A('wakasek'), uuidv7(), ids['free'] ?? '').expect(404);
    await assign(A('wakasek'), sessions['A-p1-8A'] ?? '', 'not-a-uuid').expect(400);
  });

  it('gives one person only one of two sessions at the same time, even when asked at once', async () => {
    pin();
    // c2 (on izin) teaches 8A p2; math holds 8B p2 now, so use free2: a fresh teacher at p2 for both.
    await person('free2', 'guru', [smp]);
    const second = sessions['A-p2-8B'] ?? '';
    await assign(A('wakasek'), second, ids['free2'] ?? '').expect(201); // moves it away from math, free2 now holds p2
    const results = await Promise.all([assign(A('wakasek'), sessions['c2-p2-8A'] ?? '', ids['math'] ?? ''), assign(A('piket'), second, ids['math'] ?? '')]);
    // Both want math at p2; the first wins, the second sees math as busy (or the session unchanged).
    expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
    const holders = await getDb().db.select({ id: schema.attendanceSessions.id }).from(schema.attendanceSessions).where(and(eq(schema.attendanceSessions.teacherId, ids['math'] ?? ''), eq(schema.attendanceSessions.schoolDate, DATE)));
    const atP2 = holders.filter((h) => [second, sessions['c2-p2-8A']].includes(h.id));
    expect(atP2).toHaveLength(1);
  });

  it('is behind the capability and needs a login', async () => {
    pin();
    await assign(A('wakasek'), sessions['A-p1-8A'] ?? '', ids['free'] ?? '', off).expect(404);
    await t.agent().post('/api/v1/substitutions').set('X-School-Id', smp).send({}).expect(401);
  });
});

describe('daily sessions (GRU-03)', () => {
  it('substitutes a wali kelas, and refuses another wali kelas who holds a daily session that day', async () => {
    pin();
    const homeroom: string[] = [];
    for (const name of ['wali1', 'wali2', 'wali3']) {
      const p = await t.staff(`Pengganti ${name}`);
      ids[name] = p.id;
      await t.member(sd, p.id, 'guru');
      homeroom.push(p.id);
    }
    const spare = await t.staff('Pengganti spare');
    ids['spare'] = spare.id;
    await t.member(sd, spare.id, 'guru');
    const daily: string[] = [];
    await withTenant({ schoolId: sd, userId: null }, async (tx) => {
      const [year] = await tx.insert(schema.academicYears).values({ schoolId: sd, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
      for (const [i, name] of ['1A', '1B', '1C'].entries()) {
        const [cls] = await tx.insert(schema.classes).values({ schoolId: sd, academicYearId: year?.id ?? '', name, grade: 1, homeroomTeacherId: homeroom[i] ?? null }).returning();
        const [session] = await tx.insert(schema.attendanceSessions).values({ schoolId: sd, schoolDate: DATE, mode: 'daily', ownerType: 'class', ownerId: cls?.id ?? '', teacherId: homeroom[i] ?? null }).returning();
        daily.push(session?.id ?? '');
      }
    });
    await leave(sd, homeroom[0] ?? '');
    const list = await items(A('wakasek'), DATE, sd);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ status: 'needed', session: { mode: 'daily', owner: { name: '1A' }, period: null }, absentTeacher: { id: homeroom[0] } });
    expect(reasonOf(await assign(A('wakasek'), daily[0] ?? '', homeroom[1] ?? '', sd).expect(409))).toBe('busy');
    const free = (await get(A('wakasek'), `/substitutions/candidates?sessionId=${daily[0]}`, sd).expect(200)).body as { items: Candidate[] };
    expect(free.items.map((c) => c.userId)).toEqual(expect.arrayContaining([ids['spare'], ids['piket'], ids['wakasek']]));
    expect(free.items.map((c) => c.userId)).not.toContain(homeroom[1]);
    await assign(A('wakasek'), daily[0] ?? '', ids['spare'] ?? '', sd).expect(201);
    expect((await items(A('wakasek'), DATE, sd))[0]).toMatchObject({ status: 'assigned', substitute: { id: ids['spare'] } });
  });
});

describe('audit and push (GRU-03)', () => {
  it('audits who assigned whom without names, and emits one event per assignment', async () => {
    const logs = await getDb().db.select({ action: schema.auditLogs.action, before: schema.auditLogs.before, after: schema.auditLogs.after }).from(schema.auditLogs).where(eq(schema.auditLogs.schoolId, smp));
    const mine = logs.filter((l) => l.action === 'teacher.substitute_assigned');
    expect(mine.length).toBeGreaterThanOrEqual(5);
    expect(mine[0]?.after).toMatchObject({ teacherId: expect.any(String) as string });
    expect(JSON.stringify(mine)).not.toMatch(/Pengganti|Demam/);
    const events = await getDb().db.select().from(schema.outboxEvents).where(and(eq(schema.outboxEvents.schoolId, smp), eq(schema.outboxEvents.type, 'teacher.substitute_assigned')));
    expect(events.length).toBe(mine.length);
  });

  it('tells the substitute, only the substitute, with a link to the session and nothing personal', async () => {
    const sender = new FakePushSender();
    const consumers = new Map(pushConsumers({ push: sender }).map((c) => [c.name, c]));
    const target = await t.staff('Pengganti push');
    await t.member(smp, target.id, 'guru');
    const agent = t.agent();
    await signIn(agent, target.email).expect(200);
    const endpoint = `https://push.example.test/sub/${uuidv7()}`;
    await agent.put('/api/v1/push/subscriptions').set('X-School-Id', smp).set('Idempotency-Key', uuidv7()).send({ endpoint, keys: { p256dh: Buffer.alloc(65, 9).toString('base64url'), auth: Buffer.alloc(16, 9).toString('base64url') } }).expect(200);
    const sessionId = sessions['A-p1-8A'] ?? '';
    const event = { id: uuidv7(), schoolId: smp, type: 'teacher.substitute_assigned' as const, payload: { sessionId, substituteId: target.id }, traceId: null, occurredAt: new Date().toISOString() };
    expect(await runConsumer(consumers.get('notify_push_substitute_assigned') as Consumer, event)).toBe('handled');
    expect(sender.sent.map((s) => s.target.endpoint)).toEqual([endpoint]);
    expect(sender.sent[0]?.message).toMatchObject({ body: 'Anda ditugaskan menjadi guru pengganti. Ketuk untuk melihat.', url: `/sesi/${sessionId}`, tag: `substitute:${sessionId}` });
    expect(sender.sent[0]?.message.body).not.toMatch(/8A|Matematika|absent|Pengganti/);
    expect(await runConsumer(consumers.get('notify_push_substitute_assigned') as Consumer, event)).toBe('duplicate');
  });
});
