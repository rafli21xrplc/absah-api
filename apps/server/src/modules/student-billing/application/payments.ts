import type { MyBillsList, RequestStudentPaymentRequest, StudentPayment } from '@absah/contracts';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError } from '../../../shared/errors';
import { defineConsumer, emit, type Consumer } from '../../../shared/outbox';
import { anyRole, type Actor } from '../../../shared/policy';
import { PaymentError, type PaymentProvider } from '../../../shared/payments';
import { canPayStudentBills } from '../domain/policies';
import { findBill } from '../infrastructure/bill-repo';
import { insertPayment, lockMyInstallment, lockPayment, myBillIds, openPayments, updatePayment } from '../infrastructure/payment-repo';
import { viewBills } from './bills';
import { toPayment } from './payment-view';

/** How long a VA / QRIS stays payable. */
export const STUDENT_PAYMENT_VALID_HOURS = 24;

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const holder = (actor: Actor): 'student' | 'parent' => (anyRole('siswa').allows(actor) ? 'student' : 'parent');

/** GET /student-billing/mine: the bills of the caller's own children (or of the student themself), with the charge to pay. */
export function myBills(actor: Actor, today: string, now = new Date()): Promise<MyBillsList> {
  authorize(actor, canPayStudentBills);
  return withTenant(scope(actor), async (tx) => {
    const rows = [];
    for (const id of await myBillIds(tx, actor.userId, holder(actor))) {
      const row = await findBill(tx, id);
      if (row) rows.push(row);
    }
    return { items: await viewBills(tx, rows, today, now) };
  });
}

/**
 * POST /student-billing/installments/{id}/payments. Only for an installment of the caller's own child's open bill that is
 * not paid; an open attempt of the same method is reused (a second tap is the same VA); otherwise the request is stored
 * and the gateway call is left to the worker (CLAUDE.md rule 3).
 */
export async function requestStudentPayment(actor: Actor, auditCtx: AuditContext, provider: PaymentProvider | null, installmentId: string, input: RequestStudentPaymentRequest, now = new Date()): Promise<StudentPayment> {
  authorize(actor, canPayStudentBills);
  if (!provider) throw new ConflictError('Pembayaran online belum tersedia. Hubungi sekolah untuk cara bayar.', { reason: 'payments_unavailable' });
  return withTenant(scope(actor), async (tx) => {
    const installment = await lockMyInstallment(tx, installmentId, actor.userId, holder(actor));
    if (!installment) throw new NotFoundError('Tagihan tidak ditemukan.');
    if (installment.billStatus === 'void') throw new ConflictError('Tagihan ini dibatalkan.', { reason: 'bill_void' });
    if (installment.paidAt || installment.billStatus === 'paid') throw new ConflictError('Cicilan ini sudah lunas.', { reason: 'already_paid' });
    const open = (await openPayments(tx, installmentId)).find((p) => p.method === input.method && p.provider === provider.name && !(p.expiresAt && p.expiresAt <= now));
    if (open) return toPayment(open, now);
    const row = await insertPayment(tx, { schoolId: actor.schoolId, installmentId, provider: provider.name, method: input.method, amount: installment.amount, requestedBy: actor.userId });
    await audit(tx, auditCtx, 'billing.student_payment_requested', { type: 'student_payment', id: row.id }, { after: { installmentId, method: input.method, amount: installment.amount } });
    await emit(tx, 'student_payment.requested', { paymentId: row.id });
    return toPayment(row, now);
  });
}

/**
 * Worker: opens the VA / QRIS at the gateway. The payment id is the gateway's external id, so a retry after a crash gets
 * the same charge. Retryable errors throw until the last attempt, then the payment is failed (the parent asks again).
 */
export function studentBillingConsumers(provider: PaymentProvider | null, now: () => Date = () => new Date()): Consumer[] {
  if (!provider) return [];
  const open = defineConsumer({
    name: 'student_billing_open_payment',
    event: 'student_payment.requested',
    retryLimit: 2,
    async handle(tx, event, delivery) {
      const payment = await lockPayment(tx, event.payload.paymentId);
      if (!payment || payment.status !== 'requested') return;
      const at = now();
      try {
        const charge = await provider.createCharge({
          reference: payment.id,
          amount: payment.amount,
          method: payment.method,
          description: `${payment.title} (cicilan ${payment.number})`.slice(0, 100),
          expiresAt: new Date(at.getTime() + STUDENT_PAYMENT_VALID_HOURS * 3_600_000),
        });
        await updatePayment(tx, payment.id, { status: 'pending', providerRef: charge.providerRef, vaBank: charge.vaBank, vaNumber: charge.vaNumber, qrString: charge.qrString, expiresAt: charge.expiresAt });
      } catch (err) {
        const retryable = !(err instanceof PaymentError) || err.retryable;
        if (retryable && !delivery.lastAttempt) throw err;
        await updatePayment(tx, payment.id, { status: 'failed', lastError: err instanceof PaymentError ? err.code : 'unexpected' });
      }
    },
  });
  return [open];
}
