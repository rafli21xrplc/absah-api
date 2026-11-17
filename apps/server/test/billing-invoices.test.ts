import type { InvoiceDetail, InvoiceList } from '@absah/contracts';
import { schema } from '@absah/db';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { issueDueInvoices, issueInvoiceForSchool, setBillingExempt } from '../src/modules/subscription';
import { withTenant } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let other: string;
let admin: Agent;
let kepsek: Agent;
let guru: Agent;
// 07.00 WIB on 1 February 2027: the job issues January.
const FEB_1 = new Date('2027-02-01T00:00:00Z');
const bodyOf = <T>(res: { body: unknown }) => res.body as T;
const get = (agent: Agent, path: string) => agent.get(`/api/v1${path}`).set('X-School-Id', school);

/**
 * January 2027 (31 days), counted by hand:
 * ANI whole month 31; BUDI joins 16 Jan 16; CITRA leaves after 10 Jan 10;
 * DEDI changes rombel on 13 Jan (two enrollments) 31; EKA left in December 0.
 * total = round(10000 x 88 / 31) = round(28387.10) = 28387.
 */
const STUDENTS: [string, [string, string | null][]][] = [
  ['ANI', [['2026-07-13', null]]],
  ['BUDI', [['2027-01-16', null]]],
  ['CITRA', [['2026-07-13', '2027-01-10']]],
  [
    'DEDI',
    [
      ['2026-07-13', '2027-01-12'],
      ['2027-01-13', null],
    ],
  ],
  ['EKA', [['2026-07-13', '2026-12-18']]],
];

beforeAll(async () => {
  [school, other] = await Promise.all([t.school('smp', 'SMP Tagihan'), t.school('smp', 'SMP Lain')]);
  const [a, k, g] = await Promise.all([t.staff('Admin Tagihan'), t.staff('Kepsek Tagihan'), t.staff('Guru Tagihan')]);
  await t.member(school, a.id, 'admin');
  await t.member(school, k.id, 'kepsek');
  await t.member(school, g.id, 'guru');
  [admin, kepsek, guru] = [t.agent(), t.agent(), t.agent()];
  await signIn(admin, a.email).expect(200);
  await enableTotp(admin);
  await signIn(kepsek, k.email).expect(200);
  await signIn(guru, g.email).expect(200);

  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-13', endsOn: '2027-06-30', isActive: true }).returning();
    const academicYearId = year?.id ?? '';
    const [a7, b7] = await tx
      .insert(schema.classes)
      .values([
        { schoolId: school, academicYearId, name: 'VII A', grade: 7 },
        { schoolId: school, academicYearId, name: 'VII B', grade: 7 },
      ])
      .returning();
    for (const [n, [name, periods]] of STUDENTS.entries()) {
      const [s] = await tx.insert(schema.students).values({ schoolId: school, name: `${name} TAGIHAN`, nisn: `009900000${n}` }).returning();
      for (const [i, [startsOn, endsOn]] of periods.entries()) {
        await tx.insert(schema.enrollments).values({
          schoolId: school,
          studentId: s?.id ?? '',
          classId: (i === 0 ? a7 : b7)?.id ?? '',
          academicYearId,
          startsOn,
          endsOn,
          status: endsOn ? (periods.length > 1 ? 'class_changed' : 'left') : 'active',
        });
      }
    }
  });
});

describe('bil.issue-invoices', () => {
  it('issues last month on the 1st, matching the hand count, once', async () => {
    const result = await issueDueInvoices(FEB_1);
    expect(result.month).toBe('2027-01');
    // Again (days 2-7 catch-up, or a retried job): nothing new for this school.
    expect(await issueInvoiceForSchool(school, '2027-01', FEB_1)).toBeNull();

    const list = bodyOf<InvoiceList>(await get(admin, '/billing/invoices').expect(200));
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ month: '2027-01', total: 28_387, status: 'issued', studentCount: 4, billedDays: 88, daysInMonth: 31, exemptDays: 0, dueOn: '2027-02-15', paidAt: null });
  });

  it('shows one line per billed student with the exact share', async () => {
    const [invoice] = bodyOf<InvoiceList>(await get(kepsek, '/billing/invoices').expect(200)).items;
    const detail = bodyOf<InvoiceDetail>(await get(kepsek, `/billing/invoices/${invoice?.id}`).expect(200));
    expect(detail.lines.map((l) => [l.name, l.days, l.amount])).toEqual([
      ['ANI TAGIHAN', 31, '10000.0000'],
      ['BUDI TAGIHAN', 16, '5161.2903'],
      ['CITRA TAGIHAN', 10, '3225.8065'],
      ['DEDI TAGIHAN', 31, '10000.0000'],
    ]);
  });

  it('does not bill the long year-end break marked by the Absah team', async () => {
    expect(await setBillingExempt(school, '2027-06-21', '2027-06-30', 'Libur akhir tahun ajaran', true)).toBe(10);
    // ANI, BUDI, DEDI: 20 of 30 days each -> round(10000 x 60 / 30) = 20000.
    expect(await issueInvoiceForSchool(school, '2027-06', new Date('2027-07-01T00:00:00Z'))).toMatchObject({ total: 20_000 });
    const june = bodyOf<InvoiceList>(await get(admin, '/billing/invoices').expect(200)).items.find((i) => i.month === '2027-06');
    expect(june).toMatchObject({ exemptDays: 10, billedDays: 60, studentCount: 3 });
  });

  it('issues nothing for a school without students', async () => {
    expect(await issueInvoiceForSchool(other, '2027-01', FEB_1)).toBeNull();
  });
});

describe('GET /billing/invoices', () => {
  it('is for the admin and kepala sekolah only', async () => {
    await get(guru, '/billing/invoices').expect(403);
  });

  it('answers 404 for an unknown invoice or a malformed id', async () => {
    await get(admin, '/billing/invoices/0190a000-0000-7000-8000-000000000000').expect(404);
    await get(admin, '/billing/invoices/nope').expect(400);
  });
});
