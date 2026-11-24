import type { AttendanceStatus, CollectionDashboardList, PrincipalDashboard } from '@absah/contracts';
import { schema } from '@absah/db';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2027-01-14T03:00:00Z'));
});
afterAll(() => vi.useRealTimers());

let schoolA: string;
let schoolB: string;
let schoolC: string;
let loner: string;
let otherCollectionSchool: string;
let leader: Agent;
let adminOnly: Agent;
let outsider: Agent;
const get = (agent: Agent) => agent.get('/api/v1/dashboard/collections');
const own = async (agent: Agent, schoolId: string) => (await agent.get('/api/v1/dashboard/principal').set('X-School-Id', schoolId).expect(200)).body as PrincipalDashboard;

/** One rombel; `letters` are today's statuses, one per student. */
async function seed(schoolId: string, letters: string) {
  await withTenant({ schoolId, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId, academicYearId: year?.id ?? '', name: '7A', grade: 7 }).returning();
    for (const [i, status] of [...letters].entries()) {
      const [s] = await tx.insert(schema.students).values({ schoolId, name: `Siswa ${i}` }).returning();
      const [e] = await tx.insert(schema.enrollments).values({ schoolId, studentId: s?.id ?? '', classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' }).returning();
      await tx.insert(schema.dailyAttendance).values({ schoolId, enrollmentId: e?.id ?? '', schoolDate: '2027-01-14', status: status as AttendanceStatus });
    }
  });
}

beforeAll(async () => {
  const school = (x: string) => t.school('smp', `SMP Yayasan ${x}`);
  [schoolA, schoolB, schoolC, loner, otherCollectionSchool] = [await school('A'), await school('B'), await school('C'), await school('D'), await school('E')];
  const db = getDb().db;
  const [foundation, other] = await db.insert(schema.collections).values([{ name: 'Yayasan Tunas' }, { name: 'Yayasan Lain' }]).returning();
  for (const [id, collectionId] of [[schoolA, foundation?.id], [schoolB, foundation?.id], [schoolC, foundation?.id], [otherCollectionSchool, other?.id]] as const) {
    await db.update(schema.schools).set({ collectionId: collectionId ?? null }).where(eq(schema.schools.id, id));
  }
  await seed(schoolA, 'HHHA'); // 3 of 4
  await seed(schoolB, 'HTSAAH'); // 3 of 6
  await seed(schoolC, 'AAAA');
  await seed(loner, 'HHHH');
  await seed(otherCollectionSchool, 'HH');

  const person = await t.staff('Ketua Yayasan');
  await t.member(schoolA, person.id, 'kepsek');
  await t.member(schoolB, person.id, 'wakasek');
  await t.member(schoolC, person.id, 'guru'); // a seat, but not a leader's
  await t.member(loner, person.id, 'kepsek'); // leads, but the school belongs to no collection
  leader = t.agent();
  await signIn(leader, person.email).expect(200);

  // Admin of one school of the collection: counts only with two-step login.
  const admin = await t.staff('Admin Yayasan');
  await t.member(schoolA, admin.id, 'admin');
  adminOnly = t.agent();
  await signIn(adminOnly, admin.email).expect(200);

  const stranger = await t.staff('Orang Luar');
  await t.member(otherCollectionSchool, stranger.id, 'guru');
  outsider = t.agent();
  await signIn(outsider, stranger.email).expect(200);
});

describe('GET /dashboard/collections (RKP-06)', () => {
  it('adds up the schools the caller leads, and only those', async () => {
    const { items } = (await get(leader).expect(200)).body as CollectionDashboardList;
    expect(items.map((c) => c.name)).toEqual(['Yayasan Tunas']);
    const [tunas] = items;
    expect(tunas?.schools.map((s) => s.name)).toEqual(['SMP Yayasan A', 'SMP Yayasan B']);
    expect(tunas?.totals.schools).toBe(2);
    // 3 of 4 present in A and 3 of 6 in B: 6 of 10 together, not the mean of 0.75 and 0.5.
    expect(tunas?.totals.attendance).toEqual({ days: 10, present: 6, presentRate: 0.6 });
    expect(tunas?.trend).toEqual([{ date: '2027-01-14', present: 6, days: 10, presentRate: 0.6 }]);
    expect(tunas?.totals.atRiskStudents).toBe(0); // SMP has early warnings on and none were raised
  });

  it('shows the same numbers as each school’s own dashboard', async () => {
    const { items } = (await get(leader).expect(200)).body as CollectionDashboardList;
    for (const school of items[0]?.schools ?? []) {
      const d = await own(leader, school.schoolId);
      expect(school.attendance.days).toBe(d.attendance.today.days);
      expect(school.attendance.presentRate).toBe(d.attendance.today.presentRate);
      expect(school.sessions).toEqual(d.sessions);
    }
  });

  it('counts an admin only with two-step login', async () => {
    expect(((await get(adminOnly).expect(200)).body as CollectionDashboardList).items).toEqual([]);
    await enableTotp(adminOnly);
    const { items } = (await get(adminOnly).expect(200)).body as CollectionDashboardList;
    expect(items.map((c) => c.schools.map((s) => s.name))).toEqual([['SMP Yayasan A']]);
  });

  it('is empty for someone with no leading seat in a collection, and needs a session', async () => {
    expect(((await get(outsider).expect(200)).body as CollectionDashboardList).items).toEqual([]);
    await t.agent().get('/api/v1/dashboard/collections').expect(401);
  });
});
