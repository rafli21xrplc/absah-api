import { INVOICE_STATUSES, PAYMENT_METHODS, PAYMENT_STATUSES } from '@absah/contracts';
import { sql } from 'drizzle-orm';
import { bigint, char, date, index, integer, numeric, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { students } from './academic';
import { user } from './auth';
import { createdAt, id, schoolId } from './_shared';
import { schools } from './platform';

export const invoiceStatus = pgEnum('invoice_status', INVOICE_STATUSES);
export const paymentMethod = pgEnum('payment_method', PAYMENT_METHODS);
export const paymentStatus = pgEnum('payment_status', PAYMENT_STATUSES);

const at = (name: string) => timestamp(name, { withTimezone: true });
const rupiah = (name: string) => bigint(name, { mode: 'number' });

/**
 * Absah's monthly invoice to one workspace (BIL). One per school and month (job bil.issue-invoices
 * is idempotent on it). total is whole rupiah, rounded once on the total. The app role cannot delete
 * invoices or their lines.
 */
export const invoices = pgTable(
  'invoices',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    /** YYYY-MM of the billed month. */
    month: char('month', { length: 7 }).notNull(),
    daysInMonth: integer('days_in_month').notNull(),
    unitPrice: rupiah('unit_price').notNull(),
    exemptDays: integer('exempt_days').notNull(),
    studentCount: integer('student_count').notNull(),
    billedDays: integer('billed_days').notNull(),
    total: rupiah('total').notNull(),
    status: invoiceStatus('status').notNull().default('issued'),
    issuedAt: at('issued_at').notNull().defaultNow(),
    dueOn: date('due_on').notNull(),
    paidAt: at('paid_at'),
  },
  (t) => [unique('invoices_school_id_month_key').on(t.schoolId, t.month), index('invoices_school_id_status_idx').on(t.schoolId, t.status)],
);

/** One student of an invoice: billed days and the exact share before rounding. */
export const invoiceLines = pgTable(
  'invoice_lines',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    studentId: uuid('student_id').references(() => students.id, { onDelete: 'set null' }),
    days: integer('days').notNull(),
    amount: numeric('amount', { precision: 14, scale: 4 }).notNull(),
  },
  (t) => [index('invoice_lines_school_id_invoice_id_idx').on(t.schoolId, t.invoiceId)],
);

/**
 * One payment attempt (VA or QRIS) for an invoice through a PaymentProvider. provider_txn_id is the
 * provider's id of the money that arrived: unique, so a webhook delivered twice records one payment.
 */
export const payments = pgTable(
  'payments',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    invoiceId: uuid('invoice_id')
      .notNull()
      .references(() => invoices.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    method: paymentMethod('method').notNull(),
    status: paymentStatus('status').notNull().default('requested'),
    amount: rupiah('amount').notNull(),
    /** The provider's id of the charge (VA / QR) we opened. */
    providerRef: text('provider_ref'),
    vaBank: text('va_bank'),
    vaNumber: text('va_number'),
    qrString: text('qr_string'),
    expiresAt: at('expires_at'),
    providerTxnId: text('provider_txn_id'),
    paidAt: at('paid_at'),
    lastError: text('last_error'),
    requestedBy: uuid('requested_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('payments_school_id_invoice_id_idx').on(t.schoolId, t.invoiceId, t.createdAt),
    uniqueIndex('payments_provider_ref_key').on(t.provider, t.providerRef).where(sql`${t.providerRef} is not null`),
    uniqueIndex('payments_provider_txn_id_key').on(t.provider, t.providerTxnId).where(sql`${t.providerTxnId} is not null`),
  ],
);
