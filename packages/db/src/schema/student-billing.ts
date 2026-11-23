import { BILL_STATUSES, FEE_KINDS } from '@absah/contracts';
import { sql } from 'drizzle-orm';
import { bigint, boolean, check, date, index, pgEnum, pgTable, smallint, text, timestamp, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { enrollments } from './academic';
import { createdAt, id, schoolId } from './_shared';
import { user } from './auth';
import { schools } from './platform';
import { paymentMethod, paymentStatus } from './subscription';

export const feeKind = pgEnum('fee_kind', FEE_KINDS);
export const billStatus = pgEnum('bill_status', BILL_STATUSES);

const at = (name: string) => timestamp(name, { withTimezone: true });
const rupiah = (name: string) => bigint(name, { mode: 'number' });
const schoolRef = () => schoolId().references(() => schools.id, { onDelete: 'cascade' });
const userRef = (name: string) => uuid(name).references(() => user.id, { onDelete: 'set null' });

/** The kinds of fee a school charges (TGH-01: SPP, kegiatan, ...). Switched off with active = false; bills keep pointing at it. */
export const feeTypes = pgTable(
  'fee_types',
  {
    id: id(),
    schoolId: schoolRef(),
    name: text('name').notNull(),
    kind: feeKind('kind').notNull(),
    /** Whole rupiah proposed when issuing; every bill carries its own total. */
    defaultAmount: rupiah('default_amount').notNull(),
    active: boolean('active').notNull().default(true),
    createdBy: userRef('created_by'),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex('fee_types_school_id_name_key').on(t.schoolId, sql`lower(${t.name})`), check('fee_types_default_amount_check', sql`${t.defaultAmount} >= 0`)],
);

/**
 * What one student owes for one fee (TGH-01). `period` names what it is for ("2026-11", "Semester 1") and makes a mass
 * issue idempotent: the same student, fee type and period is one bill however often the issue is repeated. A bill is
 * never deleted; the school voids it (void_reason). total is the sum of its installments (check in the app, one row
 * per bill when there is no plan).
 */
export const studentBills = pgTable(
  'student_bills',
  {
    id: id(),
    schoolId: schoolRef(),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    feeTypeId: uuid('fee_type_id')
      .notNull()
      .references(() => feeTypes.id, { onDelete: 'restrict' }),
    period: text('period').notNull(),
    title: text('title').notNull(),
    total: rupiah('total').notNull(),
    dueOn: date('due_on').notNull(),
    status: billStatus('status').notNull().default('open'),
    paidAt: at('paid_at'),
    voidedAt: at('voided_at'),
    voidReason: text('void_reason'),
    issuedBy: userRef('issued_by'),
    createdAt: createdAt(),
  },
  (t) => [
    unique('student_bills_enrollment_fee_period_key').on(t.schoolId, t.enrollmentId, t.feeTypeId, t.period),
    index('student_bills_school_id_enrollment_id_idx').on(t.schoolId, t.enrollmentId),
    index('student_bills_school_id_status_due_on_idx').on(t.schoolId, t.status, t.dueOn),
    check('student_bills_total_check', sql`${t.total} > 0`),
    check('student_bills_void_check', sql`(${t.status} = 'void') = (${t.voidedAt} is not null)`),
  ],
);

/** TGH-02 cicilan: the parts of a bill with their own amount and due date; a bill without a plan has exactly one. */
export const billInstallments = pgTable(
  'bill_installments',
  {
    id: id(),
    schoolId: schoolRef(),
    billId: uuid('bill_id')
      .notNull()
      .references(() => studentBills.id, { onDelete: 'cascade' }),
    number: smallint('number').notNull(),
    amount: rupiah('amount').notNull(),
    dueOn: date('due_on').notNull(),
    paidAt: at('paid_at'),
    /** The reminder before the due date went out (once per installment). */
    remindedAt: at('reminded_at'),
  },
  (t) => [
    unique('bill_installments_bill_id_number_key').on(t.billId, t.number),
    index('bill_installments_school_id_due_on_idx').on(t.schoolId, t.dueOn).where(sql`${t.paidAt} is null`),
    check('bill_installments_amount_check', sql`${t.amount} > 0`),
  ],
);

/**
 * One attempt to pay an installment through the gateway (TGH-03), the same life as a subscription payment: requested,
 * the worker opens the charge, the webhook marks it paid. provider_txn_id is unique per provider, so a webhook that
 * arrives twice records one payment.
 */
export const studentPayments = pgTable(
  'student_payments',
  {
    id: id(),
    schoolId: schoolRef(),
    installmentId: uuid('installment_id')
      .notNull()
      .references(() => billInstallments.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    method: paymentMethod('method').notNull(),
    status: paymentStatus('status').notNull().default('requested'),
    amount: rupiah('amount').notNull(),
    providerRef: text('provider_ref'),
    vaBank: text('va_bank'),
    vaNumber: text('va_number'),
    qrString: text('qr_string'),
    expiresAt: at('expires_at'),
    providerTxnId: text('provider_txn_id'),
    paidAt: at('paid_at'),
    lastError: text('last_error'),
    requestedBy: userRef('requested_by'),
    createdAt: createdAt(),
  },
  (t) => [
    index('student_payments_school_id_installment_id_idx').on(t.schoolId, t.installmentId, t.createdAt),
    uniqueIndex('student_payments_provider_ref_key').on(t.provider, t.providerRef).where(sql`${t.providerRef} is not null`),
    uniqueIndex('student_payments_provider_txn_id_key').on(t.provider, t.providerTxnId).where(sql`${t.providerTxnId} is not null`),
    check('student_payments_amount_check', sql`${t.amount} > 0`),
  ],
);

