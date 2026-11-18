import { schema } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

type Activity = { id: string; name: string; days: number[]; coaches: { id: string; name: string }[]; memberCount: number; active: boolean; location: string };
let school: string;
let wakasek: Agent;
let pembina: Agent;
let guru: Agent;
let ids: Record<string, string>;
let enrollments: Record<string, string>;
let pramuka: string;
const key = () => `act-${uuidv7()}`;
const send = (agent: Agent, method: 'post' | 'patch' | 'put', path: string, body: object) =>
  agent[method](`/api/v1${path}`).set('X-School-Id', school).set('Idempotency-Key', key()).send(body);
const get = (agent: Agent, path: string) => agent.get(`/api/v1${path}`).set('X-School-Id', school);

beforeAll(async () => {
  school = await t.school('smp', 'SMP Kegiatan');
  ids = {};
  const agents: Record<string, Agent> = {};
  for (const [label, role] of [
    ['wakasek', 'wakasek'],
    ['pembina', 'guru'],
    ['guru', 'guru'],
  ] as const) {
    const u = await t.staff(`Pak ${label}`);
    ids[label] = u.id;
    await t.member(school, u.id, role);
    agents[label] = t.agent();
    await signIn(agents[label], u.email).expect(200);
  }
  wakasek = agents.wakasek as Agent;
  await enableTotp(wakasek);
  pembina = agents.pembina as Agent;
  guru = agents.guru as Agent;
  const parent = await t.staff('Orang Tua');
  ids.parent = parent.id;
  await t.member(school, parent.id, 'orang_tua');

  enrollments = await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [old] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2025/2026', startsOn: '2025-07-01', endsOn: '2026-06-30', isActive: false }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: '7A', grade: 7 }).returning();
    const [oldCls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: old?.id ?? '', name: '6A', grade: 6 }).returning();
    const students = await tx.insert(schema.students).values(['ANI', 'BUDI', 'CICI'].map((name) => ({ schoolId: school, name }))).returning();
    const rows = await tx
      .insert(schema.enrollments)
      .values([
        { schoolId: school, studentId: students[0]?.id ?? '', classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' },
        { schoolId: school, studentId: students[1]?.id ?? '', classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' },
        { schoolId: school, studentId: students[2]?.id ?? '', classId: oldCls?.id ?? '', academicYearId: old?.id ?? '', startsOn: '2025-07-13' },
      ])
      .returning();
    return { ANI: rows[0]?.id ?? '', BUDI: rows[1]?.id ?? '', OLD: rows[2]?.id ?? '' };
  });
});

describe('activities (KEG-01)', () => {
  it('lets the wakasek create an activity with its coach', async () => {
    const res = await send(wakasek, 'post', '/activities', { name: 'Pramuka', kind: 'ekskul', location: 'sekolah', days: [5, 1], coachIds: [ids.pembina] }).expect(200);
    const a = res.body as Activity;
    pramuka = a.id;
    expect(a).toMatchObject({ name: 'Pramuka', days: [1, 5], active: true, memberCount: 0, coaches: [{ id: ids.pembina, name: 'Pak pembina' }] });
  });

  it('refuses a duplicate name, a non-staff coach, wrong dates, and a guru creating', async () => {
    await send(wakasek, 'post', '/activities', { name: 'Pramuka', kind: 'ekskul', location: 'sekolah', days: [], coachIds: [ids.pembina] }).expect(409);
    const parent = await send(wakasek, 'post', '/activities', { name: 'Futsal', kind: 'ekskul', location: 'sekolah', days: [], coachIds: [ids.parent] }).expect(400);
    expect(JSON.stringify(parent.body)).toContain('Pembina harus staf aktif');
    await send(wakasek, 'post', '/activities', { name: 'Kemah', kind: 'lainnya', location: 'luar_sekolah', days: [], startsOn: '2026-12-10', endsOn: '2026-12-01', coachIds: [ids.pembina] }).expect(400);
    await send(guru, 'post', '/activities', { name: 'Futsal', kind: 'ekskul', location: 'sekolah', days: [], coachIds: [ids.guru] }).expect(403);
  });

  it('shows a coach only their activities, and hides others with 404', async () => {
    await send(wakasek, 'post', '/activities', { name: 'Kemah Bakti', kind: 'lainnya', location: 'luar_sekolah', days: [], startsOn: '2026-12-01', endsOn: '2026-12-03', coachIds: [ids.guru] }).expect(200);
    const mine = (await get(pembina, '/activities').expect(200)).body as { items: Activity[] };
    expect(mine.items.map((a) => a.name)).toEqual(['Pramuka']);
    const all = (await get(wakasek, '/activities').expect(200)).body as { items: Activity[] };
    expect(all.items.map((a) => a.name)).toEqual(['Kemah Bakti', 'Pramuka']);
    await get(guru, `/activities/${pramuka}`).expect(404);
    await get(pembina, `/activities/${pramuka}`).expect(200);
  });

  it('lets the coach set members from active students of this year', async () => {
    const found = (await get(pembina, '/activities/students?q=an').expect(200)).body as { items: { name: string }[] };
    expect(found.items.map((s) => s.name)).toEqual(['ANI']);
    const res = await send(pembina, 'put', `/activities/${pramuka}/members`, { enrollmentIds: [enrollments.ANI, enrollments.BUDI, enrollments.ANI] }).expect(200);
    expect((res.body as { items: { name: string; className: string }[] }).items).toEqual([
      { enrollmentId: enrollments.ANI, name: 'ANI', className: '7A' },
      { enrollmentId: enrollments.BUDI, name: 'BUDI', className: '7A' },
    ]);
    await send(pembina, 'put', `/activities/${pramuka}/members`, { enrollmentIds: [enrollments.OLD] }).expect(400);
    await send(guru, 'put', `/activities/${pramuka}/members`, { enrollmentIds: [] }).expect(404);
    expect(((await get(wakasek, `/activities/${pramuka}`).expect(200)).body as Activity).memberCount).toBe(2);
  });

  it('keeps editing to managers: coaches, days, deactivation', async () => {
    await send(pembina, 'patch', `/activities/${pramuka}`, { active: false }).expect(403);
    const res = await send(wakasek, 'patch', `/activities/${pramuka}`, { days: [3], coachIds: [ids.pembina, ids.guru], active: false }).expect(200);
    expect(res.body as Activity).toMatchObject({ days: [3], active: false, coaches: [{ id: ids.pembina }, { id: ids.guru }] });
    await send(wakasek, 'patch', `/activities/${pramuka}`, { name: 'Kemah Bakti' }).expect(409);
  });

  it('allows ibadah berjamaah only with religious.worship (KEG-03)', async () => {
    const res = await send(wakasek, 'post', '/activities', { name: 'Dzuhur berjamaah', kind: 'ibadah', location: 'sekolah', days: [1, 2, 3, 4, 5], coachIds: [ids.pembina] }).expect(404);
    expect((res.body as { code: string }).code).toBe('CAPABILITY_DISABLED');
    await send(wakasek, 'patch', `/activities/${pramuka}`, { kind: 'ibadah' }).expect(404);

    const ma = await t.school('sma', 'MA Ibadah');
    await getDb().db.update(schema.schools).set({ isMadrasah: true }).where(eq(schema.schools.id, ma));
    await t.member(ma, ids.wakasek ?? '', 'wakasek');
    await t.member(ma, ids.pembina ?? '', 'guru');
    await withTenant({ schoolId: ma, userId: null }, (tx) => tx.insert(schema.academicYears).values({ schoolId: ma, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }));
    const created = await wakasek
      .post('/api/v1/activities')
      .set('X-School-Id', ma)
      .set('Idempotency-Key', key())
      .send({ name: 'Dzuhur berjamaah', kind: 'ibadah', location: 'sekolah', days: [1, 2, 3, 4, 5], coachIds: [ids.pembina] })
      .expect(200);
    expect(created.body as Activity).toMatchObject({ name: 'Dzuhur berjamaah', days: [1, 2, 3, 4, 5] });
  });
});
