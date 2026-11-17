import type { AttendanceStatus, ClassRecapDetail, ClassRecapList, ReportSemesterList, SessionCompliance } from '@absah/contracts';
import { schema } from '@absah/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let wakasek: Agent;
let admin: Agent;
let wali: Agent;
let guru: Agent;
const ids = { classA: '', classB: '', wali: '', guru: '' };
const bodyOf = <T>(res: { body: unknown }) => res.body as T;
const get = (agent: Agent, path: string) => agent.get(`/api/v1${path}`).set('X-School-Id', school);

/** Rekap fixture, counted by hand: one string per student, one letter per school day 11-15 Jan 2027. */
const DATES = ['2027-01-11', '2027-01-12', '2027-01-13', '2027-01-14', '2027-01-15'];
const A_DAYS: Record<string, string> = { 'ANI LESTARI': 'HHTSA', 'BUDI SANTOSO': 'HIIHH' };
// Citra moves from 10A to 10B after 12 Jan: HH in 10A, then HAH in 10B.
const CITRA_A = 'HH';
const CITRA_B = 'HAH';

beforeAll(async () => {
  school = await t.school('sma', 'SMA Rekap');
  const [k, a, w, g] = await Promise.all([t.staff('Wakasek Rekap'), t.staff('Admin Rekap'), t.staff('Bu Wali Rekap'), t.staff('Pak Guru Rekap')]);
  ids.wali = w.id;
  ids.guru = g.id;
  await t.member(school, k.id, 'wakasek');
  await t.member(school, a.id, 'admin');
  await t.member(school, w.id, 'guru');
  await t.member(school, g.id, 'guru');
  [wakasek, admin, wali, guru] = [t.agent(), t.agent(), t.agent(), t.agent()];
  await signIn(wakasek, k.email).expect(200);
  await signIn(admin, a.email).expect(200);
  await enableTotp(admin);
  await signIn(wali, w.email).expect(200);
  await signIn(guru, g.email).expect(200);

  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const academicYearId = year?.id ?? '';
    await tx.insert(schema.semesters).values([
      { schoolId: school, academicYearId, number: 1, startsOn: '2026-07-13', endsOn: '2026-12-19' },
      { schoolId: school, academicYearId, number: 2, startsOn: '2027-01-04', endsOn: '2027-06-19' },
    ]);
    const [a10, b10] = await tx
      .insert(schema.classes)
      .values([
        { schoolId: school, academicYearId, name: '10A', grade: 10, homeroomTeacherId: w.id },
        { schoolId: school, academicYearId, name: '10B', grade: 10 },
      ])
      .returning();
    ids.classA = a10?.id ?? '';
    ids.classB = b10?.id ?? '';
    const enroll = async (name: string, classId: string, startsOn: string, endsOn: string | null, days: string, firstDay = 0) => {
      const [s] = await tx.insert(schema.students).values({ schoolId: school, name }).returning();
      return { studentId: s?.id ?? '', enrollmentId: await enrollIn(s?.id ?? '', classId, startsOn, endsOn, days, firstDay) };
    };
    const enrollIn = async (studentId: string, classId: string, startsOn: string, endsOn: string | null, days: string, firstDay = 0) => {
      const [e] = await tx
        .insert(schema.enrollments)
        .values({ schoolId: school, studentId, classId, academicYearId, startsOn, endsOn, status: endsOn ? 'class_changed' : 'active' })
        .returning();
      const rows = [...days].map((status, i) => ({ schoolId: school, enrollmentId: e?.id ?? '', schoolDate: DATES[firstDay + i] ?? '', status: status as AttendanceStatus }));
      if (rows.length) await tx.insert(schema.dailyAttendance).values(rows);
      return e?.id ?? '';
    };
    const enrolled = [];
    for (const [name, days] of Object.entries(A_DAYS)) enrolled.push(await enroll(name, ids.classA, '2026-07-13', null, days));
    const citra = await enroll('CITRA DEWI', ids.classA, '2026-07-13', '2027-01-12', CITRA_A);
    await enrollIn(citra.studentId, ids.classB, '2027-01-13', null, CITRA_B, 2);
    // Semester 1, outside every period asked below: never counted.
    await tx.insert(schema.dailyAttendance).values({ schoolId: school, enrollmentId: enrolled[0]?.enrollmentId ?? '', schoolDate: '2026-12-01', status: 'A' });

    // Sessions for RKP-04: the wali fills 3 of 4 (one after the reminder), the guru misses 2 of 3, one open today.
    const session = (teacherId: string | null, ownerId: string, schoolDate: string, status: 'open' | 'submitted' | 'missed' | 'locked', late = false) => ({
      schoolId: school,
      schoolDate,
      mode: 'daily' as const,
      ownerType: 'class' as const,
      ownerId,
      teacherId,
      status,
      submittedAt: status === 'submitted' || status === 'locked' ? new Date(`${schoolDate}T05:00:00Z`) : null,
      remindedAt: late ? new Date(`${schoolDate}T03:10:00Z`) : null,
    });
    await tx.insert(schema.attendanceSessions).values([
      session(w.id, ids.classA, '2027-01-11', 'locked'),
      session(w.id, ids.classA, '2027-01-12', 'locked', true),
      session(w.id, ids.classA, '2027-01-13', 'missed'),
      session(w.id, ids.classA, '2027-01-14', 'submitted'),
      session(g.id, ids.classB, '2027-01-11', 'missed'),
      session(g.id, ids.classB, '2027-01-12', 'missed'),
      session(g.id, ids.classB, '2027-01-13', 'locked'),
      session(g.id, ids.classB, '2027-01-14', 'open'),
    ]);
  });
});

const count = (...days: string[]) => {
  const c: Record<AttendanceStatus, number> = { H: 0, T: 0, S: 0, I: 0, A: 0 };
  for (const d of days.join('')) c[d as AttendanceStatus] += 1;
  return c;
};
const WEEK = '?from=2027-01-11&to=2027-01-15';

describe('rekap per rombel (RKP-01)', () => {
  it('matches the hand count for every rombel', async () => {
    const res = await get(wakasek, `/reports/attendance/classes${WEEK}`).expect(200);
    const list = bodyOf<ClassRecapList>(res);
    expect(list.items.map((c) => c.name)).toEqual(['10A', '10B']);
    const [a, b] = list.items;
    expect(a).toMatchObject({ students: 3, counts: count(...Object.values(A_DAYS), CITRA_A), days: 12, homeroom: { id: ids.wali, name: 'Bu Wali Rekap' } });
    expect(a?.presentRate).toBeCloseTo(8 / 12, 4);
    expect(b).toMatchObject({ students: 1, counts: count(CITRA_B), days: 3, homeroom: null });
  });

  it('gives the wali kelas only their rombel', async () => {
    const list = bodyOf<ClassRecapList>(await get(wali, `/reports/attendance/classes${WEEK}`).expect(200));
    expect(list.items.map((c) => c.id)).toEqual([ids.classA]);
  });

  it('refuses teachers without a rombel', async () => {
    await get(guru, `/reports/attendance/classes${WEEK}`).expect(403);
  });

  it('rejects a bad period', async () => {
    await get(wakasek, '/reports/attendance/classes?from=2027-01-15&to=2027-01-11').expect(400);
    await get(wakasek, '/reports/attendance/classes?from=2026-01-01&to=2027-01-11').expect(400);
    await get(wakasek, '/reports/attendance/classes').expect(400);
  });
});

describe('rekap per siswa (RKP-01, RKP-02)', () => {
  it('matches the hand count per student, with the move', async () => {
    const detail = bodyOf<ClassRecapDetail>(await get(wali, `/reports/attendance/classes/${ids.classA}${WEEK}`).expect(200));
    expect(detail.items.map((i) => [i.name, i.counts, i.active])).toEqual([
      ['ANI LESTARI', count(A_DAYS['ANI LESTARI'] ?? ''), true],
      ['BUDI SANTOSO', count(A_DAYS['BUDI SANTOSO'] ?? ''), true],
      ['CITRA DEWI', count(CITRA_A), false],
    ]);
    expect(detail.totals).toMatchObject({ counts: count(...Object.values(A_DAYS), CITRA_A), days: 12 });
    expect(detail.class).toMatchObject({ name: '10A', homeroom: { name: 'Bu Wali Rekap' } });
  });

  it('gives a daily rekap for one day', async () => {
    const detail = bodyOf<ClassRecapDetail>(await get(admin, `/reports/attendance/classes/${ids.classA}?from=2027-01-15&to=2027-01-15`).expect(200));
    // Citra's enrollment in 10A ended on 12 Jan, so the day has only Ani and Budi.
    expect(detail.items.map((i) => [i.name, i.counts.A, i.counts.H])).toEqual([
      ['ANI LESTARI', 1, 0],
      ['BUDI SANTOSO', 0, 1],
    ]);
  });

  it('counts a semester and leaves days outside it out', async () => {
    const detail = bodyOf<ClassRecapDetail>(await get(wakasek, `/reports/attendance/classes/${ids.classA}?from=2027-01-04&to=2027-06-19`).expect(200));
    expect(detail.totals.days).toBe(12);
  });

  it("hides other rombel from a wali kelas and refuses other teachers", async () => {
    await get(wali, `/reports/attendance/classes/${ids.classB}${WEEK}`).expect(404);
    await get(guru, `/reports/attendance/classes/${ids.classA}${WEEK}`).expect(403);
  });
});

describe('semesters and session compliance (RKP-04)', () => {
  it('lists semesters of the active year', async () => {
    const list = bodyOf<ReportSemesterList>(await get(wali, '/reports/semesters').expect(200));
    expect(list.items.map((s) => [s.number, s.startsOn, s.endsOn])).toEqual([
      [1, '2026-07-13', '2026-12-19'],
      [2, '2027-01-04', '2027-06-19'],
    ]);
  });

  it('counts filled, late, missed and open sessions per teacher and day', async () => {
    const report = bodyOf<SessionCompliance>(await get(wakasek, `/reports/session-compliance${WEEK}`).expect(200));
    expect(report.totals).toEqual({ sessions: 8, filled: 4, filledLate: 1, missed: 3, open: 1, fillRate: 0.5714 });
    expect(report.teachers.map((r) => [r.teacher?.name, r.filled, r.missed, r.fillRate])).toEqual([
      ['Pak Guru Rekap', 1, 2, 0.3333],
      ['Bu Wali Rekap', 3, 1, 0.75],
    ]);
    expect(report.days.map((d) => [d.date, d.sessions])).toEqual([
      ['2027-01-11', 2],
      ['2027-01-12', 2],
      ['2027-01-13', 2],
      ['2027-01-14', 2],
    ]);
  });

  it('is for wakasek, kepsek and admin only', async () => {
    await get(admin, `/reports/session-compliance${WEEK}`).expect(200);
    await get(wali, `/reports/session-compliance${WEEK}`).expect(403);
  });
});
