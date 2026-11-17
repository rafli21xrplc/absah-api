import { schema, type Tx } from '@absah/db';
import { and, asc, desc, eq, gte, isNull, lte, or } from 'drizzle-orm';
import type { ComputedInvoice } from '../domain/invoice';

const inv = schema.invoices;
const e = schema.enrollments;

export const billingSchools = (tx: Tx) => tx.select({ id: schema.schools.id }).from(schema.schools).orderBy(asc(schema.schools.id));

/** Every enrollment (any year, any rombel) that overlaps the month. */
export function enrollmentsInMonth(tx: Tx, first: string, last: string) {
  return tx
    .select({ studentId: e.studentId, from: e.startsOn, to: e.endsOn })
    .from(e)
    .where(and(lte(e.startsOn, last), or(isNull(e.endsOn), gte(e.endsOn, first))));
}

export async function exemptDaysInMonth(tx: Tx, first: string, last: string): Promise<string[]> {
  const c = schema.calendarDays;
  const rows = await tx.select({ date: c.date }).from(c).where(and(eq(c.billingExempt, true), gte(c.date, first), lte(c.date, last)));
  return rows.map((r) => r.date);
}

/** Inserts the invoice and its lines unless the month is already issued; returns the new id or null. */
export async function insertInvoice(tx: Tx, schoolId: string, computed: ComputedInvoice, dueOn: string, now: Date): Promise<string | null> {
  const [row] = await tx
    .insert(inv)
    .values({
      schoolId,
      month: computed.month,
      daysInMonth: computed.daysInMonth,
      unitPrice: computed.unitPrice,
      exemptDays: computed.exemptDays,
      studentCount: computed.lines.length,
      billedDays: computed.billedDays,
      total: computed.total,
      issuedAt: now,
      dueOn,
    })
    .onConflictDoNothing({ target: [inv.schoolId, inv.month] })
    .returning({ id: inv.id });
  if (!row) return null;
  // 1000 lines per statement keeps parameters well under the Postgres limit.
  for (let i = 0; i < computed.lines.length; i += 1000) {
    await tx.insert(schema.invoiceLines).values(
      computed.lines.slice(i, i + 1000).map((l) => ({ schoolId, invoiceId: row.id, studentId: l.studentId, days: l.days, amount: l.amount.toFixed(4) })),
    );
  }
  return row.id;
}

const invoiceColumns = {
  id: inv.id,
  month: inv.month,
  status: inv.status,
  total: inv.total,
  unitPrice: inv.unitPrice,
  daysInMonth: inv.daysInMonth,
  exemptDays: inv.exemptDays,
  studentCount: inv.studentCount,
  billedDays: inv.billedDays,
  issuedAt: inv.issuedAt,
  dueOn: inv.dueOn,
  paidAt: inv.paidAt,
};
export type InvoiceRow = Awaited<ReturnType<typeof listInvoices>>[number];

export const listInvoices = (tx: Tx) => tx.select(invoiceColumns).from(inv).orderBy(desc(inv.month));

export async function findInvoice(tx: Tx, id: string) {
  const [row] = await tx.select(invoiceColumns).from(inv).where(eq(inv.id, id));
  return row ?? null;
}

export function invoiceLines(tx: Tx, invoiceId: string) {
  const l = schema.invoiceLines;
  const s = schema.students;
  return tx
    .select({ studentId: l.studentId, name: s.name, nisn: s.nisn, days: l.days, amount: l.amount })
    .from(l)
    .leftJoin(s, eq(s.id, l.studentId))
    .where(eq(l.invoiceId, invoiceId))
    .orderBy(asc(s.name), asc(l.id));
}
