import type { BillsQuery, IssueBillsRequest, IssueBillsResult, StudentBill, StudentBillList, StudentPayment, VoidBillRequest } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { isOverdue, paidAmount, planInstallments } from '../domain/installments';
import { canManageBilling, canReadStudentBills } from '../domain/policies';
import { findFeeType } from '../infrastructure/fee-repo';
import { latestPayments } from '../infrastructure/payment-repo';
import { toPayment } from './payment-view';
import { activeEnrollmentsOf, classExists, findBill, hasPaidInstallment, insertInstallments, insertNewBills, installmentsOf, listBills, lockBill, markVoid, type BillRow, type InstallmentRow } from '../infrastructure/bill-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });

/** The bills with the latest payment attempt of each installment (the charge to pay, or what came of it). */
export async function viewBills(tx: Tx, rows: BillRow[], today: string, now = new Date()): Promise<StudentBill[]> {
  const parts = await installmentsOf(tx, rows.map((r) => r.id));
  const attempts = await latestPayments(tx, parts.map((p) => p.id));
  return rows.map((r) => view(r, parts.filter((p) => p.billId === r.id), today, (id) => {
    const a = attempts.get(id);
    return a ? toPayment(a, now) : null;
  }));
}

function view(row: BillRow, parts: InstallmentRow[], today: string, paymentOf: (installmentId: string) => StudentPayment | null): StudentBill {
  const items = parts.map((p) => ({ id: p.id, number: p.number, amount: p.amount, dueOn: p.dueOn, paidAt: p.paidAt?.toISOString() ?? null, payment: paymentOf(p.id) }));
  return {
    id: row.id,
    enrollmentId: row.enrollmentId,
    student: { name: row.studentName, className: row.className },
    feeType: { id: row.feeTypeId, name: row.feeTypeName },
    period: row.period,
    title: row.title,
    total: row.total,
    paid: paidAmount(parts),
    dueOn: row.dueOn,
    status: row.status,
    overdue: isOverdue(row.status, parts, today),
    paidAt: row.paidAt?.toISOString() ?? null,
    voidedAt: row.voidedAt?.toISOString() ?? null,
    voidReason: row.voidReason,
    installments: items,
  };
}

/**
 * POST /student-billing/issue (TGH-01/02). One bill per active student of the rombel or grade, for the fee type and
 * period; students who already have that bill are left alone (counted as skipped), so repeating the request, or
 * sending it twice, bills nobody twice. The whole issue is one transaction: all of it, or none.
 */
export function issueBills(actor: Actor, auditCtx: AuditContext, input: IssueBillsRequest): Promise<IssueBillsResult> {
  authorize(actor, canManageBilling);
  return withTenant(scope(actor), async (tx) => {
    const fee = await findFeeType(tx, input.feeTypeId);
    if (!fee) throw new NotFoundError('Jenis tagihan tidak ditemukan.');
    if (!fee.active) throw new ConflictError('Jenis tagihan ini sudah dinonaktifkan.', { reason: 'fee_type_inactive' });
    if (input.target.kind === 'class' && !(await classExists(tx, input.target.classId))) throw new NotFoundError('Rombel tidak ditemukan.');
    const total = input.amount ?? fee.defaultAmount;
    if (total <= 0) throw new ValidationError([{ path: 'amount', message: 'Isi nominal tagihan.' }]);
    const plan = planInstallments(total, input.dueOn, input.installments);
    if (!plan.ok) throw new ValidationError([{ path: input.installments ? 'installments' : 'dueOn', message: plan.message }]);
    const enrollments = await activeEnrollmentsOf(tx, input.target);
    if (enrollments.length === 0) throw new ConflictError('Tidak ada siswa aktif pada sasaran ini.', { reason: 'no_students' });

    const title = input.title ?? `${fee.name} ${input.period}`;
    const rows = enrollments.map((enrollmentId) => ({ id: uuidv7(), schoolId: actor.schoolId, enrollmentId, feeTypeId: fee.id, period: input.period, title, total, dueOn: plan.dueOn, issuedBy: actor.userId }));
    const created = await insertNewBills(tx, rows);
    await insertInstallments(tx, created.flatMap((billId) => plan.items.map((p) => ({ schoolId: actor.schoolId, billId, ...p }))));
    const result = { created: created.length, skipped: enrollments.length - created.length, billed: created.length * total };
    await audit(tx, auditCtx, 'billing.bills_issued', { type: 'fee_type', id: fee.id }, { after: { ...result, period: input.period, target: input.target, installments: plan.items.length } });
    return result;
  });
}

export function listStudentBills(actor: Actor, query: BillsQuery, today: string): Promise<StudentBillList> {
  authorize(actor, canReadStudentBills);
  return withTenant(scope(actor), async (tx) => {
    const { rows, total } = await listBills(tx, query, today);
    return { items: await viewBills(tx, rows, today), total };
  });
}

/**
 * POST /student-billing/bills/{id}/void. A bill is never deleted. One with money already paid cannot be voided (that is
 * a refund, which this does not do); an unpaid one is withdrawn with the reason.
 */
export function voidBill(actor: Actor, auditCtx: AuditContext, billId: string, input: VoidBillRequest, today: string, now = new Date()): Promise<StudentBill> {
  authorize(actor, canManageBilling);
  return withTenant(scope(actor), async (tx) => {
    const locked = await lockBill(tx, billId);
    if (!locked) throw new NotFoundError('Tagihan tidak ditemukan.');
    if (locked.status === 'void') throw new ConflictError('Tagihan ini sudah dibatalkan.', { reason: 'already_void' });
    if (locked.status === 'paid' || (await hasPaidInstallment(tx, billId))) throw new ConflictError('Tagihan yang sudah dibayar tidak bisa dibatalkan.', { reason: 'has_payments' });
    await markVoid(tx, billId, input.reason, now);
    await audit(tx, auditCtx, 'billing.bill_voided', { type: 'student_bill', id: billId }, { after: { reason: input.reason } });
    const row = await findBill(tx, billId);
    if (!row) throw new Error('bill vanished');
    return (await viewBills(tx, [row], today))[0] as StudentBill;
  });
}
