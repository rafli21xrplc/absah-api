import { z } from 'zod';
import { InvoiceStatus } from './enums';

/** Absah's monthly invoice to a workspace (BIL). Amounts are whole rupiah. */
export const Invoice = z
  .object({
    id: z.uuid(),
    /** YYYY-MM of the billed month. */
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),
    status: InvoiceStatus,
    total: z.int().nonnegative(),
    unitPrice: z.int().positive(),
    daysInMonth: z.int().min(28).max(31),
    /** Days of the month not billed (long year-end break). */
    exemptDays: z.int().nonnegative(),
    studentCount: z.int().nonnegative(),
    /** Sum of billed student-days; total = round(unitPrice x billedDays / daysInMonth). */
    billedDays: z.int().nonnegative(),
    issuedAt: z.iso.datetime(),
    dueOn: z.iso.date(),
    paidAt: z.iso.datetime().nullable(),
  })
  .meta({ id: 'Invoice' });
export type Invoice = z.infer<typeof Invoice>;

/** GET /api/v1/billing/invoices: newest first. */
export const InvoiceList = z.object({ items: z.array(Invoice) }).meta({ id: 'InvoiceList' });
export type InvoiceList = z.infer<typeof InvoiceList>;

/** GET /api/v1/billing/invoices/{invoiceId}: the invoice and one line per billed student. */
export const InvoiceDetail = Invoice.extend({
  lines: z.array(
    z.object({
      studentId: z.uuid().nullable(),
      name: z.string().nullable(),
      nisn: z.string().nullable(),
      days: z.int().positive(),
      /** Exact share before rounding, e.g. "3225.8065" (the total is rounded once). */
      amount: z.string(),
    }),
  ),
}).meta({ id: 'InvoiceDetail' });
export type InvoiceDetail = z.infer<typeof InvoiceDetail>;

export const InvoiceIdParam = z.object({ invoiceId: z.uuid() });
