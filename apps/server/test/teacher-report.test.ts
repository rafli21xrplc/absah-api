import { schema, sensitive } from '@absah/db';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());
afterEach(() => vi.useRealTimers());

/** Monday 2026-11-23, 10.00 WIB. November 2026 so far: Nov 2-6, 9-13 (10th is a holiday), 14 (a make-up Saturday), 16-20, 23 = 16 school days. */
const pin = () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-23T03:00:00Z'));
};

type Row = {
  teacher: { id: string; name: string };
  present: number;
  late: number;
  leave: { sakit: number; izin: number; dinas: number };
  noRecord: number;
  rate: number | null;
  substitutionsTaken: number;
  days?: { date: string; status: string; checkedInAt: string | null; checkedOutAt: string | null }[];
};
type Report = { month: string; schoolDays: number; through: string | null; items: Row[]; totals: { present: number; late: number; leave: number; noRecord: number; rate: number | null } };

let school: string;
let off: string;
const ids: Record<string, string> = {};
const agents: Record<string, Agent> = {};
const A = (name: string): Agent => agents[name] as Agent;
const get = (agent: Agent, query = '', schoolId = school) => agent.get(`/api/v1/teacher-attendance/report${query}`).set('X-School-Id', schoolId);
const report = async (query = '') => (await get(A('kepsek'), query).expect(200)).body as Report;
const row = (r: Report, name: string) => r.items.find((i) => i.teacher.id === ids[name]) as Row;

const nov = (d: number) => `2026-11-${String(d).padStart(2, '0')}`;
const SCHOOL_DAYS = [2, 3, 4, 5, 6, 9, 11, 12, 13, 14, 16, 17, 18, 19, 20, 23]; // the 10th is a holiday

async function checkIns(userId: string, days: number[], late: number[] = []) {
  await withTenant({ schoolId: school, userId: null }, (tx) =>
    tx.insert(schema.teacherAttendance).values(days.map((d) => ({ schoolId: school, userId, schoolDate: nov(d), checkedInAt: new Date(`${nov(d)}T00:10:00Z`), checkedOutAt: new Date(`${nov(d)}T08:00:00Z`), late: late.includes(d), source: 'app' as const }))),
  );
}
async function leave(userId: string, kind: 'sakit' | 'izin' | 'dinas', startsOn: string, endsOn: string, status: 'approved' | 'pending' | 'rejected' = 'approved') {
  await withTenant({ schoolId: school, userId: null }, (tx) => tx.insert(schema.teacherLeaves).values({ schoolId: school, userId, kind, startsOn, endsOn, reason: sensitive('x'), status }));
}

beforeAll(async () => {
  school = await t.school('smp', 'SMP Laporan Guru');
  off = await t.school('smp', 'SMP Laporan Nonaktif');
  await getDb().db.insert(schema.schoolCapabilities).values({ schoolId: off, key: 'teacher.attendance', value: false });
  const roles = { g1: 'guru', g2: 'wali_kelas', g3: 'guru', g4: 'piket', ghost: 'operator', kepsek: 'kepsek', wakasek: 'wakasek', admin: 'admin', guru: 'guru', uks: 'petugas_uks' } as const;
  for (const [name, role] of Object.entries(roles)) {
    const p = await t.staff(`Laporan ${name}`);
    ids[name] = p.id;
    for (const s of [school, off]) await t.member(s, p.id, role);
    const agent = t.agent();
    await signIn(agent, p.email).expect(200);
    if (role === 'admin') await enableTotp(agent);
    agents[name] = agent;
  }
  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    await tx.insert(schema.calendarDays).values([
      { schoolId: school, date: nov(10), kind: 'holiday', name: 'Hari Pahlawan' },
      { schoolId: school, date: nov(14), kind: 'school_day', name: 'Ganti hari' },
    ]);
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: '8A', grade: 8 }).returning();
    for (const [i, from] of [ids['g2'], ids['g3']].entries()) {
      const [session] = await tx.insert(schema.attendanceSessions).values({ schoolId: school, schoolDate: nov(16 + i), mode: 'daily', ownerType: 'class', ownerId: cls?.id ?? '', teacherId: ids['g1'] ?? null }).returning();
      await tx.insert(schema.sessionSubstitutions).values({ schoolId: school, sessionId: session?.id ?? '', fromTeacherId: from ?? null, substituteId: ids['g1'] ?? '' });
    }
  });
  await checkIns(ids['g1'] ?? '', [2, 3, 4, 5, 6, 9, 11, 12, 13, 14], [3, 9, 13]);
  await checkIns(ids['g1'] ?? '', [10]); // came on a holiday: not a school day, not counted
  await leave(ids['g2'] ?? '', 'sakit', '2026-10-30', nov(4));
  await leave(ids['g2'] ?? '', 'izin', nov(5), nov(5), 'pending');
  await leave(ids['g2'] ?? '', 'izin', nov(6), nov(6), 'rejected');
  await leave(ids['g4'] ?? '', 'dinas', nov(16), nov(20));
  await checkIns(ids['g4'] ?? '', [17]); // came during the dinas week: present wins
  await checkIns(ids['ghost'] ?? '', [23]); // not a teacher role, but has a record this month
});

describe('GET /teacher-attendance/report (GRU-04)', () => {
  it('counts school days up to today: the calendar decides, holiday out, make-up Saturday in', async () => {
    pin();
    const r = await report('?month=2026-11');
    expect(r).toMatchObject({ month: '2026-11', schoolDays: SCHOOL_DAYS.length, through: '2026-11-23' });
    expect(r.schoolDays).toBe(16);
  });

  it('counts a teacher who came: present, late, no record', async () => {
    pin();
    const g1 = row(await report('?month=2026-11'), 'g1');
    expect(g1).toMatchObject({ present: 10, late: 3, leave: { sakit: 0, izin: 0, dinas: 0 }, noRecord: 6, rate: 62.5 });
  });

  it('counts approved izin by kind only, and not on days that are not school days', async () => {
    pin();
    const r = await report('?month=2026-11');
    expect(row(r, 'g2')).toMatchObject({ present: 0, leave: { sakit: 3, izin: 0, dinas: 0 }, noRecord: 13, rate: 0 }); // Oct 30 is last month; pending and rejected do not count
    expect(row(r, 'g4')).toMatchObject({ present: 1, leave: { dinas: 4 }, noRecord: 11 }); // the 17th they came
  });

  it('shows a teacher with nothing as all no-record, and someone with a record even without a teacher role', async () => {
    pin();
    const r = await report('?month=2026-11');
    expect(row(r, 'g3')).toMatchObject({ present: 0, noRecord: 16, rate: 0 });
    expect(row(r, 'ghost')).toMatchObject({ present: 1 });
    expect(r.items.find((i) => i.teacher.id === ids['kepsek'])).toBeUndefined();
    expect(r.items.find((i) => i.teacher.id === ids['uks'])).toBeUndefined();
  });

  it('counts the sessions a teacher took over from others', async () => {
    pin();
    const r = await report('?month=2026-11');
    expect(row(r, 'g1').substitutionsTaken).toBe(2);
    expect(row(r, 'g2').substitutionsTaken).toBe(0);
  });

  it('adds up in the totals and sorts by name', async () => {
    pin();
    const r = await report('?month=2026-11');
    expect(r.totals.present).toBe(r.items.reduce((n, i) => n + i.present, 0));
    expect(r.totals.late).toBe(3);
    expect(r.totals.leave).toBe(3 + 4);
    expect(r.totals.rate).toBe(Math.round((r.totals.present / (16 * r.items.length)) * 1000) / 10);
    const names = r.items.map((i) => i.teacher.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, 'id')));
  });

  it("gives one teacher's days, with the times, when teacherId is asked for", async () => {
    pin();
    const r = await report(`?month=2026-11&teacherId=${ids['g1']}`);
    expect(r.items).toHaveLength(1);
    const days = r.items[0]?.days ?? [];
    expect(days.map((d) => d.date)).toEqual(SCHOOL_DAYS.map(nov));
    expect(days.find((d) => d.date === nov(3))).toMatchObject({ status: 'late', checkedInAt: '2026-11-03T00:10:00.000Z', checkedOutAt: '2026-11-03T08:00:00.000Z' });
    expect(days.find((d) => d.date === nov(2))?.status).toBe('present');
    expect(days.find((d) => d.date === nov(16))).toMatchObject({ status: 'none', checkedInAt: null });
    const g4 = (await report(`?month=2026-11&teacherId=${ids['g4']}`)).items[0]?.days ?? [];
    expect(g4.filter((d) => d.status === 'dinas')).toHaveLength(4);
    expect(g4.find((d) => d.date === nov(17))?.status).toBe('present');
    expect((await report('?month=2026-11')).items.every((i) => i.days === undefined)).toBe(true);
  });

  it('counts a past month whole, with an izin that began the month before', async () => {
    pin();
    const r = await report('?month=2026-10');
    expect(r).toMatchObject({ schoolDays: 22, through: '2026-10-31' });
    expect(row(r, 'g2')).toMatchObject({ leave: { sakit: 1 }, noRecord: 21 });
  });

  it('has nothing to count in a month still ahead, and defaults to the current month', async () => {
    pin();
    const future = await report('?month=2026-12');
    expect(future).toMatchObject({ schoolDays: 0, through: null, totals: { present: 0, rate: null } });
    expect(row(future, 'g1')).toMatchObject({ present: 0, noRecord: 0, rate: null });
    expect((await report()).month).toBe('2026-11');
  });

  it('is for the kepsek, the wakasek and the admin only, behind the capability', async () => {
    pin();
    for (const name of ['kepsek', 'wakasek', 'admin']) await get(A(name)).expect(200);
    for (const name of ['guru', 'g1', 'uks']) await get(A(name)).expect(403);
    await get(A('kepsek'), '', off).expect(404);
    await t.agent().get('/api/v1/teacher-attendance/report').set('X-School-Id', school).expect(401);
  });

  it('refuses a bad month, and a teacherId that is nobody’s in this school', async () => {
    pin();
    for (const month of ['2026-13', '2026-1', 'november', '2026-11-01']) await get(A('kepsek'), `?month=${month}`).expect(400);
    await get(A('kepsek'), `?teacherId=${ids['kepsek']}`).expect(404);
    await get(A('kepsek'), '?teacherId=not-a-uuid').expect(400);
  });
});
