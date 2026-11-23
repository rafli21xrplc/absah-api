import { schema } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let a: string;
let b: string;
const app = (school: string) => ({ schoolId: school, userId: null });
const invoice = (schoolId: string, month: string) => ({
  schoolId,
  month,
  daysInMonth: 31,
  unitPrice: 10_000,
  exemptDays: 0,
  studentCount: 1,
  billedDays: 31,
  total: 10_000,
  dueOn: '2027-02-15',
});

beforeAll(async () => {
  [a, b] = await Promise.all([t.school('sd', 'SD Tagihan A'), t.school('sd', 'SD Tagihan B')]);
});

describe('billing tables', () => {
  it('keep invoices per school, one per month, never deleted by the app role', async () => {
    const [inv] = await withTenant(app(a), (tx) => tx.insert(schema.invoices).values(invoice(a, '2027-01')).returning());
    await withTenant(app(a), (tx) => tx.insert(schema.invoiceLines).values({ schoolId: a, invoiceId: inv?.id ?? '', days: 31, amount: '10000.0000' }));
    await expect(withTenant(app(a), (tx) => tx.insert(schema.invoices).values(invoice(a, '2027-01')))).rejects.toThrow();
    await expect(withTenant(app(a), (tx) => tx.delete(schema.invoices))).rejects.toThrow();
    await expect(withTenant(app(a), (tx) => tx.delete(schema.invoiceLines))).rejects.toThrow();
    await expect(withTenant(app(a), (tx) => tx.update(schema.invoiceLines).set({ days: 1 }))).rejects.toThrow();

    // Another school sees none of it.
    await withTenant(app(b), async (tx) => {
      expect(await tx.select().from(schema.invoices)).toHaveLength(0);
      expect(await tx.select().from(schema.invoiceLines)).toHaveLength(0);
      expect(await tx.select().from(schema.payments)).toHaveLength(0);
    });
  });

  it('record a provider transaction once', async () => {
    const [inv] = await withTenant(app(a), (tx) => tx.insert(schema.invoices).values(invoice(a, '2027-02')).returning());
    const payment = { schoolId: a, invoiceId: inv?.id ?? '', provider: 'fake', method: 'va' as const, amount: 10_000, providerTxnId: 'txn-1' };
    await withTenant(app(a), (tx) => tx.insert(schema.payments).values(payment));
    await expect(withTenant(app(a), (tx) => tx.insert(schema.payments).values(payment))).rejects.toThrow();
  });
});

describe('calendar_days.billing_exempt', () => {
  const day = (date: string, billingExempt = false) => ({ schoolId: a, date, kind: 'holiday' as const, name: 'Libur', billingExempt });

  it('cannot be set, cleared or deleted by the app role', async () => {
    await expect(withTenant(app(a), (tx) => tx.insert(schema.calendarDays).values(day('2027-06-21', true)))).rejects.toThrow();

    // The Absah team (owner role) marks the break.
    await getDb().db.insert(schema.calendarDays).values(day('2027-06-22', true));
    const exempt = and(eq(schema.calendarDays.schoolId, a), eq(schema.calendarDays.date, '2027-06-22'));
    await expect(withTenant(app(a), (tx) => tx.update(schema.calendarDays).set({ billingExempt: false }).where(exempt))).rejects.toThrow();
    await expect(withTenant(app(a), (tx) => tx.delete(schema.calendarDays).where(exempt))).rejects.toThrow();
    // Renaming the holiday is still the school's business.
    await withTenant(app(a), (tx) => tx.update(schema.calendarDays).set({ name: 'Libur kenaikan kelas' }).where(exempt));
    const [row] = await getDb().db.select().from(schema.calendarDays).where(exempt);
    expect(row).toMatchObject({ name: 'Libur kenaikan kelas', billingExempt: true });
  });

  it('leaves ordinary holidays to the school', async () => {
    const plain = and(eq(schema.calendarDays.schoolId, a), eq(schema.calendarDays.date, '2027-03-11'));
    await withTenant(app(a), (tx) => tx.insert(schema.calendarDays).values(day('2027-03-11')));
    await withTenant(app(a), (tx) => tx.update(schema.calendarDays).set({ name: 'Isra Mikraj' }).where(plain));
    await withTenant(app(a), (tx) => tx.delete(schema.calendarDays).where(plain));
    expect(await getDb().db.select().from(schema.calendarDays).where(plain)).toHaveLength(0);
  });
});
