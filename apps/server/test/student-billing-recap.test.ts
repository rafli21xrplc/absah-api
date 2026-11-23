import { schema } from '@absah/db';
import type { BillingRecap } from '@absah/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let off: string;
let spp: string;
let kegiatan: string;
const agents: Record<string, Agent> = {};
const A = (name: string): Agent => agents[name] as Agent;
const recap = (agent: Agent, query = '', schoolId = school) => agent.get(`/api/v1/student-billing/recap${query}`).set('X-School-Id', schoolId);
const body = async (query: string) => (await recap(A('bendahara'), query).expect(200)).body as BillingRecap;

beforeAll(async () => {
  school = await t.school('smp', 'SMP Rekap Tagihan');
  off = await t.school('smp', 'SMP Rekap Mati');
  await getDb().db.insert(schema.schoolCapabilities).values({ schoolId: off, key: 'student.billing', value: false });
  const roles = { bendahara: 'bendahara', admin: 'admin', kepsek: 'kepsek', wakasek: 'wakasek', guru: 'guru', wali: 'wali_kelas', ortu: 'orang_tua' } as const;
  for (const [name, role] of Object.entries(roles)) {
    const p = await t.staff(`Rekap ${name}`);
    for (const s of [school, off]) await t.member(s, p.id, role);
    const agent = t.agent();
    await signIn(agent, p.email).expect(200);
    if (role === 'admin') await enableTotp(agent);
    agents[name] = agent;
  }
  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const classes: Record<string, string> = {};
    for (const [name, grade] of [['8A', 8], ['7A', 7]] as const) classes[name] = (await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name, grade }).returning())[0]?.id ?? '';
    const enroll: Record<string, string> = {};
    for (const [name, cls] of [['Ani', '8A'], ['Budi', '8A'], ['Gita', '7A']] as const) {
      const [s] = await tx.insert(schema.students).values({ schoolId: school, name }).returning();
      enroll[name] = (await tx.insert(schema.enrollments).values({ schoolId: school, studentId: s?.id ?? '', classId: classes[cls] ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' }).returning())[0]?.id ?? '';
    }
    const fees = await tx.insert(schema.feeTypes).values([{ schoolId: school, name: 'SPP', kind: 'spp', defaultAmount: 250_000 }, { schoolId: school, name: 'Study tour', kind: 'kegiatan', defaultAmount: 100_000 }]).returning();
    spp = fees[0]?.id ?? '';
    kegiatan = fees[1]?.id ?? '';
    const past = '2020-01-10';
    const future = '2999-01-10';
    const mk = async (who: string, feeTypeId: string, total: number, parts: { amount: number; dueOn: string; paid?: boolean }[], status: 'open' | 'paid' | 'void' = 'open') => {
      const [b] = await tx.insert(schema.studentBills).values({ schoolId: school, enrollmentId: enroll[who] ?? '', feeTypeId, period: `${who}-${feeTypeId.slice(0, 4)}`, title: 'x', total, dueOn: parts[parts.length - 1]?.dueOn ?? future, status, ...(status === 'void' ? { voidedAt: new Date(), voidReason: 'x' } : {}) }).returning();
      const rows = await tx.insert(schema.billInstallments).values(parts.map((p, i) => ({ schoolId: school, billId: b?.id ?? '', number: i + 1, amount: p.amount, dueOn: p.dueOn, paidAt: p.paid ? new Date('2026-11-10T03:00:00Z') : null }))).returning();
      return rows.map((r) => r.id);
    };
    const [aniInst] = [await mk('Ani', spp, 250_000, [{ amount: 150_000, dueOn: past, paid: true }, { amount: 100_000, dueOn: past }])];
    await mk('Budi', spp, 250_000, [{ amount: 250_000, dueOn: future }]);
    const [gitaInst] = [await mk('Gita', spp, 250_000, [{ amount: 250_000, dueOn: future, paid: true }], 'paid')];
    await mk('Ani', kegiatan, 100_000, [{ amount: 100_000, dueOn: future }]);
    await mk('Budi', kegiatan, 100_000, [{ amount: 100_000, dueOn: future }], 'void');
    const pay = (installmentId: string | undefined, method: 'va' | 'qris', amount: number, paidAt: string, lastError: string | null = null) =>
      ({ schoolId: school, installmentId: installmentId ?? '', provider: 'fake', method, status: 'paid' as const, amount, paidAt: new Date(paidAt), lastError });
    await tx.insert(schema.studentPayments).values([
      pay(aniInst?.[0], 'va', 150_000, '2026-11-10T03:00:00Z'),
      pay(gitaInst?.[0], 'qris', 250_000, '2026-11-10T09:00:00Z'),
      pay(gitaInst?.[0], 'va', 250_000, '2026-11-12T03:00:00Z', 'paid_twice'),
      pay(gitaInst?.[0], 'qris', 10_000, '2026-11-30T17:30:00Z'), // 00.30 on 1 December in Jakarta
    ]);
  });
});

describe('GET /student-billing/recap (TGH-04)', () => {
  it('adds up a month’s receipts by day and method, and flags the money that counted for nothing', async () => {
    const r = await body('?month=2026-11');
    expect(r.received).toEqual({
      count: 3,
      amount: 650_000,
      va: 400_000,
      qris: 250_000,
      flagged: 1,
      days: [{ date: '2026-11-10', count: 2, amount: 400_000 }, { date: '2026-11-12', count: 1, amount: 250_000 }],
    });
  });

  it('puts a payment on the day of the school’s clock, not UTC’s', async () => {
    const december = await body('?month=2026-12');
    expect(december.received).toMatchObject({ count: 1, amount: 10_000, qris: 10_000, days: [{ date: '2026-12-01', count: 1, amount: 10_000 }] });
    expect((await body('?month=2027-03')).received).toMatchObject({ count: 0, amount: 0, days: [] });
  });

  it('shows what is owed per rombel: billed, paid, outstanding and overdue, leaving out void bills', async () => {
    const { bills } = await body('?month=2026-11');
    expect(bills).toMatchObject({ count: 4, billed: 850_000, paid: 400_000, outstanding: 450_000, overdue: 100_000 });
    expect(bills.classes.map((c) => [c.className, c.count, c.billed, c.paid, c.outstanding, c.overdue])).toEqual([
      ['8A', 3, 600_000, 150_000, 450_000, 100_000],
      ['7A', 1, 250_000, 250_000, 0, 0],
    ]);
  });

  it('narrows both parts to one fee type', async () => {
    const r = await body(`?month=2026-11&feeTypeId=${kegiatan}`);
    expect(r.received.count).toBe(0);
    expect(r.bills).toMatchObject({ count: 1, billed: 100_000, paid: 0, outstanding: 100_000, overdue: 0 });
    expect((await body(`?month=2026-11&feeTypeId=${spp}`)).bills.count).toBe(3);
    await recap(A('bendahara'), '?feeTypeId=0190a000-0000-7000-8000-000000000000').expect(404);
  });

  it('defaults to the current month', async () => {
    const r = await body('');
    expect(r.month).toMatch(/^\d{4}-\d{2}$/);
    expect(r.bills.count).toBe(4);
  });

  it('is for the bendahara, admin, kepsek and wakasek, behind the capability, with a good month', async () => {
    for (const name of ['bendahara', 'admin', 'kepsek', 'wakasek']) await recap(A(name)).expect(200);
    for (const name of ['guru', 'wali', 'ortu']) await recap(A(name)).expect(403);
    await recap(A('bendahara'), '', off).expect(404);
    await t.agent().get('/api/v1/student-billing/recap').set('X-School-Id', school).expect(401);
    for (const month of ['2026-13', '2026-1', 'november', '2026-11-01']) await recap(A('bendahara'), `?month=${month}`).expect(400);
  });
});
