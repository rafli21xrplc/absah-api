import { schema } from '@absah/db';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

type Fee = { id: string; name: string; kind: string; defaultAmount: number; active: boolean };
type Bill = {
  id: string;
  enrollmentId: string;
  student: { name: string; className: string };
  feeType: { id: string; name: string };
  period: string;
  title: string;
  total: number;
  paid: number;
  dueOn: string;
  status: string;
  overdue: boolean;
  voidReason: string | null;
  installments: { id: string; number: number; amount: number; dueOn: string; paidAt: string | null }[];
};
type BillList = { items: Bill[]; total: number };

let school: string;
let off: string;
let other: string;
let class8a: string;
let class8b: string;
let class7a: string;
let emptyClass: string;
let spp: string;
const agents: Record<string, Agent> = {};
const A = (name: string): Agent => agents[name] as Agent;
const key = () => `tgh-${uuidv7()}`;
const get = (agent: Agent, path: string, schoolId = school) => agent.get(`/api/v1/student-billing${path}`).set('X-School-Id', schoolId);
const post = (agent: Agent, path: string, body: object = {}, schoolId = school, k = key()) => agent.post(`/api/v1/student-billing${path}`).set('X-School-Id', schoolId).set('Idempotency-Key', k).send(body);
const patch = (agent: Agent, path: string, body: object) => agent.patch(`/api/v1/student-billing${path}`).set('X-School-Id', school).set('Idempotency-Key', key()).send(body);
const issue = (body: object, agent = A('bendahara'), k = key()) => post(agent, '/issue', { feeTypeId: spp, period: '2026-11', dueOn: '2999-01-10', ...body }, school, k);
const bills = async (query = '') => (await get(A('bendahara'), `/bills${query}`).expect(200)).body as BillList;

async function seed(schoolId: string) {
  return withTenant({ schoolId, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const ids: Record<string, string> = {};
    const groups = [
      { name: '8A', grade: 8, students: ['Ani 8A', 'Budi 8A', 'Citra 8A'], left: ['Dodi Pindah'] },
      { name: '8B', grade: 8, students: ['Eka 8B', 'Fajar 8B'], left: [] },
      { name: '7A', grade: 7, students: ['Gita 7A'], left: [] },
      { name: '9A', grade: 9, students: [], left: [] },
    ];
    for (const g of groups) {
      const [cls] = await tx.insert(schema.classes).values({ schoolId, academicYearId: year?.id ?? '', name: g.name, grade: g.grade }).returning();
      ids[g.name] = cls?.id ?? '';
      for (const [names, status] of [[g.students, 'active'], [g.left, 'left']] as const) {
        if (names.length === 0) continue;
        const rows = await tx.insert(schema.students).values(names.map((name) => ({ schoolId, name }))).returning();
        await tx.insert(schema.enrollments).values(rows.map((s) => ({ schoolId, studentId: s.id, classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13', status })));
      }
    }
    return ids;
  });
}

beforeAll(async () => {
  school = await t.school('smp', 'SMP Tagihan');
  off = await t.school('smp', 'SMP Tagihan Nonaktif');
  other = await t.school('smp', 'SMP Tagihan Lain');
  await getDb().db.insert(schema.schoolCapabilities).values({ schoolId: off, key: 'student.billing', value: false });
  const ids = await seed(school);
  class8a = ids['8A'] as string;
  class8b = ids['8B'] as string;
  class7a = ids['7A'] as string;
  emptyClass = ids['9A'] as string;
  const roles = { bendahara: 'bendahara', admin: 'admin', kepsek: 'kepsek', wakasek: 'wakasek', guru: 'guru', wali: 'wali_kelas', ortu: 'orang_tua' } as const;
  for (const [name, role] of Object.entries(roles)) {
    const p = await t.staff(`Tagihan ${name}`);
    for (const s of [school, off]) await t.member(s, p.id, role);
    const agent = t.agent();
    await signIn(agent, p.email).expect(200);
    if (role === 'admin') await enableTotp(agent);
    agents[name] = agent;
  }
  const outsider = await t.staff('Tagihan outsider');
  await t.member(other, outsider.id, 'bendahara');
  agents['outsider'] = t.agent();
  await signIn(A('outsider'), outsider.email).expect(200);
});

describe('fee types (TGH-01)', () => {
  it('are created by the bendahara and the admin, read by kepsek and wakasek, and closed to the rest', async () => {
    const created = await post(A('bendahara'), '/fee-types', { name: '  SPP  ', kind: 'spp', defaultAmount: 250_000 }).expect(201);
    expect(created.body).toMatchObject({ name: 'SPP', kind: 'spp', defaultAmount: 250_000, active: true });
    spp = (created.body as Fee).id;
    await post(A('admin'), '/fee-types', { name: 'Study tour', kind: 'kegiatan', defaultAmount: 1_500_000 }).expect(201);
    for (const name of ['kepsek', 'wakasek', 'bendahara']) expect(((await get(A(name), '/fee-types').expect(200)).body as { items: Fee[] }).items).toHaveLength(2);
    for (const name of ['guru', 'wali', 'ortu']) {
      await get(A(name), '/fee-types').expect(403);
      await post(A(name), '/fee-types', { name: 'Curang', kind: 'lainnya', defaultAmount: 1 }).expect(403);
    }
    for (const name of ['kepsek', 'wakasek']) await post(A(name), '/fee-types', { name: 'Curang', kind: 'lainnya', defaultAmount: 1 }).expect(403);
  });

  it('keep their names unique ignoring case, on create and on rename', async () => {
    const dup = await post(A('bendahara'), '/fee-types', { name: 'spp', kind: 'spp', defaultAmount: 1 }).expect(409);
    expect(dup.body).toMatchObject({ details: { reason: 'name_taken' } });
    const [tour] = ((await get(A('bendahara'), '/fee-types').expect(200)).body as { items: Fee[] }).items.filter((f) => f.name === 'Study tour');
    await patch(A('bendahara'), `/fee-types/${tour?.id}`, { name: 'SPP' }).expect(409);
  });

  it('are repriced, and switched off out of sight but not out of the bills', async () => {
    await patch(A('bendahara'), `/fee-types/${spp}`, { defaultAmount: 260_000 }).expect(200);
    await patch(A('bendahara'), `/fee-types/${spp}`, { defaultAmount: 250_000 }).expect(200);
    await patch(A('bendahara'), `/fee-types/${spp}`, {}).expect(400);
    const [tour] = ((await get(A('bendahara'), '/fee-types').expect(200)).body as { items: Fee[] }).items.filter((f) => f.name === 'Study tour');
    await patch(A('bendahara'), `/fee-types/${tour?.id}`, { active: false }).expect(200);
    expect(((await get(A('bendahara'), '/fee-types').expect(200)).body as { items: Fee[] }).items.map((f) => f.name)).toEqual(['SPP']);
    expect(((await get(A('bendahara'), '/fee-types?includeInactive=true').expect(200)).body as { items: Fee[] }).items).toHaveLength(2);
    await issue({ feeTypeId: tour?.id, target: { kind: 'class', classId: class8a } }).expect(409);
    await patch(A('bendahara'), `/fee-types/${uuidv7()}`, { active: true }).expect(404);
  });

  it('stay inside their school and behind the capability', async () => {
    expect(((await get(A('outsider'), '/fee-types', other).expect(200)).body as { items: Fee[] }).items).toEqual([]);
    await get(A('bendahara'), '/fee-types', off).expect(404);
    await t.agent().get('/api/v1/student-billing/fee-types').set('X-School-Id', school).expect(401);
  });
});

describe('the rombel a bill can be aimed at (TGH-01)', () => {
  it('are listed for the bendahara, who cannot read the registry, with their active students, and for no one outside billing', async () => {
    const list = (await get(A('bendahara'), '/classes').expect(200)).body as { items: { id: string; name: string; grade: number; activeStudents: number }[] };
    expect(list.items.map((c) => [c.name, c.grade, c.activeStudents])).toEqual([['7A', 7, 1], ['8A', 8, 3], ['8B', 8, 2], ['9A', 9, 0]]); // the student who left is not counted
    expect(list.items.find((c) => c.name === '8A')?.id).toBe(class8a);
    for (const name of ['admin', 'kepsek', 'wakasek']) await get(A(name), '/classes').expect(200);
    for (const name of ['guru', 'wali', 'ortu']) await get(A(name), '/classes').expect(403);
    await get(A('bendahara'), '/classes', off).expect(404);
  });
});

describe('issuing bills (TGH-01, TGH-02)', () => {
  it('bills the active students of a rombel, once however often it is sent', async () => {
    const first = await issue({ target: { kind: 'class', classId: class8a } }).expect(201);
    expect(first.body).toEqual({ created: 3, skipped: 0, billed: 750_000 }); // the student who left is not billed
    const again = await issue({ target: { kind: 'class', classId: class8a } }).expect(201);
    expect(again.body).toEqual({ created: 0, skipped: 3, billed: 0 });
    const k = key();
    const send = () => issue({ period: '2026-12', target: { kind: 'class', classId: class8a } }, A('bendahara'), k);
    // The same key at the same moment: one runs, the other may be told it is still in progress (409) and tries again.
    const settled = await Promise.all([send(), send()].map(async (p) => ((await p).status === 409 ? send() : p)));
    const [one, two] = settled;
    expect([one?.status, two?.status]).toEqual([201, 201]);
    expect(one?.body).toEqual(two?.body);
    const december = await bills('?period=2026-12');
    expect(december.total).toBe(3);
  });

  it('bills a whole grade across its rombel, skipping students who already have the bill', async () => {
    const res = await issue({ target: { kind: 'grade', grade: 8 } }).expect(201);
    expect(res.body).toEqual({ created: 2, skipped: 3, billed: 500_000 });
    const november = await bills('?period=2026-11');
    expect(november.total).toBe(5);
    expect(november.items.every((b) => b.title === 'SPP 2026-11' && b.total === 250_000 && b.paid === 0 && b.status === 'open' && !b.overdue)).toBe(true);
    expect(november.items.every((b) => b.installments.length === 1 && b.installments[0]?.amount === 250_000)).toBe(true);
  });

  it('takes its own amount and title, and plans installments that add up', async () => {
    const plan = [
      { amount: 100_000, dueOn: '2999-01-10' },
      { amount: 100_000, dueOn: '2999-02-10' },
      { amount: 100_000, dueOn: '2999-03-10' },
    ];
    await issue({ period: 'Daftar ulang', title: 'Daftar ulang 2027', amount: 300_000, dueOn: undefined, installments: plan, target: { kind: 'class', classId: class7a } }).expect(201);
    const [bill] = (await bills('?period=Daftar%20ulang')).items;
    expect(bill).toMatchObject({ title: 'Daftar ulang 2027', total: 300_000, dueOn: '2999-03-10', student: { name: 'Gita 7A', className: '7A' } });
    expect(bill?.installments.map((i) => [i.number, i.amount, i.dueOn])).toEqual([[1, 100_000, '2999-01-10'], [2, 100_000, '2999-02-10'], [3, 100_000, '2999-03-10']]);
  });

  it('refuses what cannot be billed', async () => {
    const target = { kind: 'class', classId: class8b };
    const parts = (a: number, b: number) => [{ amount: a, dueOn: '2999-01-10' }, { amount: b, dueOn: '2999-02-10' }];
    await issue({ period: 'x1', amount: 300_000, dueOn: undefined, installments: parts(100_000, 100_000), target }).expect(400); // 200,000 is not 300,000
    await issue({ period: 'x2', amount: 200_000, dueOn: undefined, installments: [{ amount: 100_000, dueOn: '2999-02-10' }, { amount: 100_000, dueOn: '2999-01-10' }], target }).expect(400); // out of order
    await issue({ period: 'x3', installments: parts(125_000, 125_000), target }).expect(400); // a due date and a plan together
    await issue({ period: 'x4', dueOn: undefined, target }).expect(400); // neither
    await issue({ period: 'x5', amount: 5, dueOn: undefined, installments: [{ amount: 5, dueOn: '2999-01-10' }], target }).expect(400); // one part is not a plan
    await issue({ period: '', target }).expect(400);
    await issue({ period: 'x6', target: { kind: 'class', classId: emptyClass } }).expect(409);
    await issue({ period: 'x7', target: { kind: 'class', classId: uuidv7() } }).expect(404);
    await issue({ period: 'x8', feeTypeId: uuidv7(), target }).expect(404);
    expect((await bills()).items.some((b) => b.period.startsWith('x'))).toBe(false); // nothing was half-issued
  });

  it('is for the bendahara and the admin only', async () => {
    for (const name of ['kepsek', 'wakasek', 'guru', 'wali', 'ortu']) await issue({ period: 'nope', target: { kind: 'class', classId: class8a } }, A(name)).expect(403);
    await issue({ period: 'dari-admin', target: { kind: 'class', classId: class8a } }, A('admin')).expect(201);
    await issue({ period: 'luar', target: { kind: 'class', classId: class8a } }, A('outsider')).expect(403);
  });

  it('writes the counts, not the students, to the audit log', async () => {
    const logs = await getDb().db.select().from(schema.auditLogs).where(eq(schema.auditLogs.schoolId, school));
    const issued = logs.filter((l) => l.action === 'billing.bills_issued');
    expect(issued.length).toBeGreaterThanOrEqual(3);
    expect(JSON.stringify(issued.map((l) => l.after))).not.toMatch(/Ani|Budi|Citra/);
    expect(issued.find((l) => (l.after as { period?: string }).period === '2026-11' && (l.after as { created: number }).created === 3)?.after).toMatchObject({ created: 3, skipped: 0, billed: 750_000 });
    expect(logs.some((l) => l.action === 'billing.fee_type_created' && (l.after as { fee?: string }).fee === 'SPP')).toBe(true);
  });
});

describe('listing and voiding bills', () => {
  it('filters by status, rombel, student and overdue, and reads them for kepsek and wakasek', async () => {
    await issue({ period: 'terlambat', dueOn: '2020-01-10', target: { kind: 'class', classId: class8b } }).expect(201);
    const late = await bills('?overdue=true');
    expect(late.total).toBe(2);
    expect(late.items.every((b) => b.overdue && b.period === 'terlambat' && b.student.className === '8B')).toBe(true);
    const inA = await bills(`?classId=${class8a}&period=2026-11`);
    expect(inA.items.map((b) => b.student.name)).toEqual(['Ani 8A', 'Budi 8A', 'Citra 8A']);
    const one = await bills(`?enrollmentId=${inA.items[0]?.enrollmentId}`);
    expect(one.items.every((b) => b.enrollmentId === inA.items[0]?.enrollmentId)).toBe(true);
    expect((await bills('?status=void')).total).toBe(0);
    const page = await bills('?limit=2');
    expect(page.items).toHaveLength(2);
    expect(page.total).toBeGreaterThan(2);
    for (const name of ['kepsek', 'wakasek', 'admin']) await get(A(name), '/bills').expect(200);
    for (const name of ['guru', 'wali', 'ortu']) await get(A(name), '/bills').expect(403);
    await get(A('bendahara'), '/bills?limit=0').expect(400);
    await get(A('bendahara'), '/bills', off).expect(404);
  });

  it('voids an unpaid bill with its reason, once, and the bill stays in the list', async () => {
    const [target] = (await bills('?period=dari-admin')).items;
    expect(target).toBeDefined();
    const voided = await post(A('bendahara'), `/bills/${target?.id}/void`, { reason: 'Salah sasaran' }).expect(200);
    expect(voided.body).toMatchObject({ status: 'void', voidReason: 'Salah sasaran', overdue: false });
    expect((await post(A('bendahara'), `/bills/${target?.id}/void`, { reason: 'Lagi' }).expect(409)).body).toMatchObject({ details: { reason: 'already_void' } });
    expect((await bills('?status=void')).items.map((b) => b.id)).toContain(target?.id);
    await post(A('bendahara'), `/bills/${target?.id}/void`, {}).expect(400);
    await post(A('kepsek'), `/bills/${target?.id}/void`, { reason: 'x' }).expect(403);
    await post(A('bendahara'), `/bills/${uuidv7()}/void`, { reason: 'x' }).expect(404);
  });

  it('refuses to void a bill with money paid on it', async () => {
    const [target] = (await bills('?period=Daftar%20ulang')).items;
    await withTenant({ schoolId: school, userId: null }, (tx) => tx.update(schema.billInstallments).set({ paidAt: new Date() }).where(eq(schema.billInstallments.id, target?.installments[0]?.id ?? '')));
    expect((await post(A('bendahara'), `/bills/${target?.id}/void`, { reason: 'Keliru' }).expect(409)).body).toMatchObject({ details: { reason: 'has_payments' } });
    const [after] = (await bills('?period=Daftar%20ulang')).items;
    expect(after).toMatchObject({ status: 'open', paid: 100_000 });
  });
});
