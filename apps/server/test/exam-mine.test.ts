import { schema } from '@absah/db';
import type { MyExams } from '@absah/contracts';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { addDays, schoolDate } from '../src/shared/school-date';
import { buildTestApp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

const today = schoolDate('Asia/Jakarta');
let school: string;
let off: string;
let periodId: string;
let citraInstallment: string;
let r1: string;
const enroll: Record<string, string> = {};
const agents: Record<string, Agent> = {};
const A = (name: string): Agent => agents[name] as Agent;
const mine = (agent: Agent, schoolId = school) => agent.get('/api/v1/exam/mine').set('X-School-Id', schoolId);
const body = async (name: string) => (await mine(A(name)).expect(200)).body as MyExams;
const days = (enrollmentId: string, status: 'H' | 'A', n: number) => Array.from({ length: n }, (_, i) => ({ schoolId: school, enrollmentId, schoolDate: `2026-09-${String(i + 1).padStart(2, '0')}`, status }));

beforeAll(async () => {
  school = await t.school('smp', 'SMP Kartu Ujian');
  off = await t.school('smp', 'SMP Kartu Mati');
  await getDb().db.insert(schema.schoolCapabilities).values({ schoolId: off, key: 'exam.enabled', value: false });
  const roles = { ortu: 'orang_tua', ortu2: 'orang_tua', siswa: 'siswa', guru: 'guru', wakasek: 'wakasek' } as const;
  const ids: Record<string, string> = {};
  for (const [name, role] of Object.entries(roles)) {
    const p = await t.staff(`Kartu ${name}`);
    ids[name] = p.id;
    for (const s of [school, off]) await t.member(s, p.id, role);
    const agent = t.agent();
    await signIn(agent, p.email).expect(200);
    agents[name] = agent;
  }
  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2020-01-01', endsOn: '2099-12-31', isActive: true }).returning();
    const yearId = year?.id ?? '';
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: yearId, name: '8A', grade: 8 }).returning();
    const student: Record<string, string> = {};
    for (const name of ['Ani', 'Budi', 'Citra']) {
      const [st] = await tx.insert(schema.students).values({ schoolId: school, name, ...(name === 'Citra' ? { userId: ids.siswa } : {}) }).returning();
      student[name] = st?.id ?? '';
      enroll[name] = (await tx.insert(schema.enrollments).values({ schoolId: school, studentId: st?.id ?? '', classId: cls?.id ?? '', academicYearId: yearId, startsOn: '2026-07-13' }).returning())[0]?.id ?? '';
    }
    const guardian = async (name: string, userId: string | undefined, children: string[]) => {
      const [g] = await tx.insert(schema.guardians).values({ schoolId: school, name, userId }).returning();
      for (const c of children) await tx.insert(schema.studentGuardians).values({ schoolId: school, studentId: student[c] ?? '', guardianId: g?.id ?? '', relation: 'ibu', isPrimary: true });
    };
    await guardian('Ibu Ani dan Budi', ids.ortu, ['Ani', 'Budi']);
    await guardian('Ibu Citra', ids.ortu2, ['Citra']);
    await tx.insert(schema.dailyAttendance).values([...days(enroll.Ani ?? '', 'H', 10), ...days(enroll.Citra ?? '', 'H', 10), ...days(enroll.Budi ?? '', 'H', 6)]);
    // Budi is absent four days in August.
    await tx.insert(schema.dailyAttendance).values(Array.from({ length: 4 }, (_, i) => ({ schoolId: school, enrollmentId: enroll.Budi ?? '', schoolDate: `2026-08-0${i + 3}`, status: 'A' as const })));
    const [fee] = await tx.insert(schema.feeTypes).values({ schoolId: school, name: 'SPP', kind: 'spp', defaultAmount: 100_000 }).returning();
    const [bill] = await tx.insert(schema.studentBills).values({ schoolId: school, enrollmentId: enroll.Citra ?? '', feeTypeId: fee?.id ?? '', period: 'Nov', title: 'SPP Nov', total: 100_000, dueOn: '2026-11-10' }).returning();
    const [inst] = await tx.insert(schema.billInstallments).values({ schoolId: school, billId: bill?.id ?? '', number: 1, amount: 100_000, dueOn: '2026-11-10' }).returning();
    citraInstallment = inst?.id ?? '';
    const periods = await tx.insert(schema.examPeriods).values([
      { schoolId: school, academicYearId: yearId, name: 'PAS', startsOn: addDays(today, 7), endsOn: addDays(today, 11), minAttendance: 75, requirePaid: true },
      { schoolId: school, academicYearId: yearId, name: 'Ujian Tutup', startsOn: addDays(today, 3), endsOn: addDays(today, 4), closedAt: new Date() },
      { schoolId: school, academicYearId: yearId, name: 'Ujian Lewat', startsOn: '2026-10-01', endsOn: '2026-10-02' },
    ]).returning();
    periodId = periods.find((p) => p.name === 'PAS')?.id ?? '';
    const [room] = await tx.insert(schema.examRooms).values({ schoolId: school, periodId, name: 'R1' }).returning();
    r1 = room?.id ?? '';
    await tx.insert(schema.examSeats).values({ schoolId: school, periodId, roomId: r1, enrollmentId: enroll.Ani ?? '', seatNo: 7 });
  });
});

describe('the exam card status (UJN-01)', () => {
  it('shows a parent each of their children for the exams still ahead, with where to sit', async () => {
    const { items } = await body('ortu');
    expect(items.map((i) => [i.student.name, i.period.name, i.eligible, i.room, i.arrived])).toEqual([
      ['Ani', 'PAS', true, { name: 'R1', seatNo: 7 }, false],
      ['Budi', 'PAS', false, null, false],
    ]); // not the closed exam, not the one that is over
    expect(items[1]?.reasons).toEqual([{ kind: 'attendance', percent: 60, minimum: 75 }]);
    expect(items[0]).toMatchObject({ className: '8A', period: { startsOn: addDays(today, 7), endsOn: addDays(today, 11) } });
  });

  it('shows only a parent’s own children, and a student themself', async () => {
    const other = await body('ortu2');
    expect(other.items.map((i) => i.student.name)).toEqual(['Citra']);
    expect(other.items[0]).toMatchObject({ eligible: false, reasons: [{ kind: 'bills', unpaidInstallments: 1 }] });
    expect((await body('siswa')).items.map((i) => i.student.name)).toEqual(['Citra']);
    expect(JSON.stringify(other)).not.toMatch(/100000|amount/); // that something is owed, never how much
  });

  it('turns to "boleh ujian" as soon as the bill is paid, and shows an arrival', async () => {
    await withTenant({ schoolId: school, userId: null }, (tx) => tx.update(schema.billInstallments).set({ paidAt: new Date() }).where(eq(schema.billInstallments.id, citraInstallment)));
    expect((await body('ortu2')).items[0]).toMatchObject({ eligible: true, reasons: [] });
    expect((await body('siswa')).items[0]?.eligible).toBe(true);
    await withTenant({ schoolId: school, userId: null }, (tx) => tx.insert(schema.examAttendance).values({ schoolId: school, periodId, roomId: r1, enrollmentId: enroll.Ani ?? '', method: 'manual' }));
    expect((await body('ortu')).items[0]).toMatchObject({ student: { name: 'Ani' }, arrived: true });
  });

  it('is for parents and students only, behind the capability, inside the school', async () => {
    await mine(A('guru')).expect(403);
    await mine(A('wakasek')).expect(403);
    await mine(A('ortu'), off).expect(404);
    await t.agent().get('/api/v1/exam/mine').set('X-School-Id', school).expect(401);
  });

  it('is empty for a family with no child in the school year', async () => {
    const p = await t.staff('Kartu kosong');
    await t.member(school, p.id, 'orang_tua');
    const agent = t.agent();
    await signIn(agent, p.email).expect(200);
    expect(((await mine(agent).expect(200)).body as MyExams).items).toEqual([]);
  });
});
