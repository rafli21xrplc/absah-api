import type { AttendanceStatus, PrincipalDashboard } from '@absah/contracts';
import { schema } from '@absah/db';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

/** Thursday 2027-01-14, 10.00 WIB. Only `Date` is pinned, so the HTTP stack keeps running. */
beforeAll(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2027-01-14T03:00:00Z'));
});
afterAll(() => vi.useRealTimers());

let school: string;
let plain: string;
const agents: Record<string, Agent> = {};
const A = (name: string) => agents[name] as Agent;
const get = (agent: Agent, schoolId = school) => agent.get('/api/v1/dashboard/principal').set('X-School-Id', schoolId);
const dashboardOf = async (agent: Agent, schoolId = school) => (await get(agent, schoolId).expect(200)).body as PrincipalDashboard;

async function seedSchool(schoolId: string, withParts: boolean) {
  const roles = [['kepsek', 'kepsek'], ['wakasek', 'wakasek'], ['admin', 'admin'], ['guru', 'guru'], ['wali', 'wali_kelas']] as const;
  for (const [label, role] of roles) {
    const person = await t.staff(`Dasbor ${label}`);
    await t.member(schoolId, person.id, role);
    const agent = t.agent();
    await signIn(agent, person.email).expect(200);
    if (role === 'admin') await enableTotp(agent);
    agents[`${schoolId === school ? '' : 'plain-'}${label}`] = agent;
  }
  const caps = withParts ? true : false;
  await getDb().db.insert(schema.schoolCapabilities).values([
    { schoolId, key: 'student.early_warning', value: caps },
    { schoolId, key: 'mbg.enabled', value: caps },
  ]);
  await withTenant({ schoolId, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const academicYearId = year?.id ?? '';
    const [cls] = await tx.insert(schema.classes).values({ schoolId, academicYearId, name: '7A', grade: 7 }).returning();
    const enrollments: string[] = [];
    for (const name of ['ANI', 'BUDI', 'CITRA', 'DEWI']) {
      const [s] = await tx.insert(schema.students).values({ schoolId, name }).returning();
      const [e] = await tx.insert(schema.enrollments).values({ schoolId, studentId: s?.id ?? '', classId: cls?.id ?? '', academicYearId, startsOn: '2026-07-13' }).returning();
      enrollments.push(e?.id ?? '');
    }
    // Per date, one letter per student. 2026-12-20 is older than the 14-day trend and must not appear.
    const days: Record<string, string> = { '2026-12-20': 'AAAA', '2027-01-12': 'HHHH', '2027-01-13': 'HHHA', '2027-01-14': 'HTSA' };
    for (const [date, letters] of Object.entries(days)) {
      await tx.insert(schema.dailyAttendance).values([...letters].map((status, i) => ({ schoolId, enrollmentId: enrollments[i] ?? '', schoolDate: date, status: status as AttendanceStatus })));
    }
    const session = (status: 'open' | 'submitted' | 'missed' | 'locked') => ({ schoolId, schoolDate: '2027-01-14', mode: 'daily' as const, ownerType: 'class' as const, ownerId: cls?.id ?? '', teacherId: null, status });
    // Each session gets its own owner id so the four rows are distinct (the dashboard counts rows).
    await tx.insert(schema.attendanceSessions).values((['submitted', 'locked', 'missed', 'open'] as const).map((status, i) => ({ ...session(status), ownerId: i === 0 ? (cls?.id ?? '') : crypto.randomUUID() })));
    if (withParts) {
      await tx.insert(schema.earlyWarnings).values([
        { schoolId, enrollmentId: enrollments[3] ?? '', kind: 'consecutive_alpa', schoolDate: '2027-01-13', dates: ['2027-01-12', '2027-01-13'] },
        { schoolId, enrollmentId: enrollments[3] ?? '', kind: 'repeated_late', schoolDate: '2027-01-14', dates: ['2027-01-12', '2027-01-14'] },
        { schoolId, enrollmentId: enrollments[1] ?? '', kind: 'repeated_late', schoolDate: '2027-01-10', dates: ['2027-01-08', '2027-01-10'] },
        // Older than a week: not in the dashboard.
        { schoolId, enrollmentId: enrollments[0] ?? '', kind: 'consecutive_alpa', schoolDate: '2027-01-02', dates: ['2027-01-01', '2027-01-02'] },
      ]);
    }
  });
}

beforeAll(async () => {
  [school, plain] = await Promise.all([t.school('smp', 'SMP Dasbor'), t.school('smp', 'SMP Dasbor Polos')]);
  await seedSchool(school, true);
  await seedSchool(plain, false);
});

describe('GET /dashboard/principal (RKP-05)', () => {
  it('shows attendance today and the trend, oldest first, without dates outside the window', async () => {
    const d = await dashboardOf(A('kepsek'));
    expect(d.schoolDate).toBe('2027-01-14');
    expect(d.attendance.today).toMatchObject({ counts: { H: 1, T: 1, S: 1, I: 0, A: 1 }, days: 4, presentRate: 0.5 });
    expect(d.attendance.trend).toEqual([
      { date: '2027-01-12', presentRate: 1, days: 4 },
      { date: '2027-01-13', presentRate: 0.75, days: 4 },
      { date: '2027-01-14', presentRate: 0.5, days: 4 },
    ]);
  });

  it('counts today’s sessions, with open ones not due yet', async () => {
    const { sessions } = await dashboardOf(A('kepsek'));
    expect(sessions).toMatchObject({ total: 4, filled: 2, missed: 1, open: 1 });
    expect(sessions.fillRate).toBeCloseTo(2 / 3, 2);
  });

  it('names the students of the last week’s warnings, the one with most kinds first', async () => {
    const { atRisk } = await dashboardOf(A('kepsek'));
    expect(atRisk?.students).toBe(2);
    expect(atRisk?.items.map((i) => i.name)).toEqual(['DEWI', 'BUDI']);
    expect(atRisk?.items[0]).toMatchObject({ className: '7A', lastDate: '2027-01-14' });
    expect([...(atRisk?.items[0]?.kinds ?? [])].sort()).toEqual(['consecutive_alpa', 'repeated_late']);
  });

  it('adds today’s MBG count when the school receives MBG', async () => {
    const { mbg } = await dashboardOf(A('kepsek'));
    expect(mbg).toMatchObject({ status: 'pending', enrolled: 4, present: 2 });
  });

  it('is the same for kepsek, wakasek and admin; refused for a guru and a wali kelas', async () => {
    const [k, w, a] = await Promise.all([dashboardOf(A('kepsek')), dashboardOf(A('wakasek')), dashboardOf(A('admin'))]);
    expect(w).toEqual(k);
    expect(a).toEqual(k);
    await get(A('guru')).expect(403);
    await get(A('wali')).expect(403);
  });

  it('leaves out the parts a school does not have, and never shows another school’s numbers', async () => {
    const d = await dashboardOf(A('plain-kepsek'), plain);
    expect(d.atRisk).toBeNull();
    expect(d.mbg).toBeNull();
    expect(d.attendance.today.days).toBe(4);
    // A kepsek of one school cannot read the other's dashboard.
    await get(A('kepsek'), plain).expect(403);
  });
});
