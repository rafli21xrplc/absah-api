import type { MyBillsList, RequestStudentPaymentRequest, StudentPayment } from '@absah/contracts';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withPlatform, withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError } from '../../../shared/errors';
import { defineConsumer, emit, markWebhookProcessed, type Consumer } from '../../../shared/outbox';
import { anyRole, type Actor } from '../../../shared/policy';
import { PaymentError, type PaymentEvent, type PaymentProvider } from '../../../shared/payments';
import { canPayStudentBills } from '../domain/policies';
import { findBill } from '../infrastructure/bill-repo';
import { insertPayment, lockInstallment, lockMyInstallment, lockPayment, markBillPaid, markInstallmentPaid, myBillIds, openPayments, paymentByProviderRef, pendingWebhooks, unpaidInstallments, updatePayment } from '../infrastructure/payment-repo';
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

/**
 * Job tgh.apply-payments: applies the gateway events stored in the inbox that are for a student payment. The inbox is
 * shared with the Absah invoices (same gateway, same webhook): an event whose charge is not one of ours is left for the
 * other job, and the subscription job drops true orphans after a day. The school is unknown until the charge is found,
 * so the inbox read and that lookup use withPlatform; the change runs in the school's withTenant.
 *
 * A paid event is recorded once: the payment's own state, plus a unique provider_txn_id, so the same webhook twice (or
 * redelivered after a crash) changes nothing the second time. Money below the amount leaves the installment open. When
 * the installment was already paid (a VA and a QRIS both paid) or the bill was voided meanwhile, the payment is still
 * recorded, with a note, because the money did arrive; no installment is counted twice or paid on a void bill.
 */
export async function applyStudentPaymentWebhooks(provider: PaymentProvider, limit = 200): Promise<{ applied: number }> {
  const rows = await withPlatform((tx) => pendingWebhooks(tx, `payment:${provider.name}`, limit));
  let applied = 0;
  for (const row of rows) {
    const e = row.payload as { providerRef: string; providerTxnId: string; status: PaymentEvent['status']; amount: number; at: string };
    const target = await withPlatform((tx) => paymentByProviderRef(tx, provider.name, e.providerRef));
    if (!target) continue;
    await withTenant({ schoolId: target.schoolId, userId: null }, async (tx) => {
      const payment = await lockPayment(tx, target.id);
      if (!payment || payment.status === 'paid') return;
      if (e.status !== 'paid') {
        await updatePayment(tx, payment.id, { status: e.status, lastError: e.status === 'failed' ? 'gateway_failed' : null });
        return;
      }
      if (e.amount < payment.amount) {
        await updatePayment(tx, payment.id, { lastError: `underpaid:${e.amount}` });
        return;
      }
      const at = new Date(e.at);
      const installment = await lockInstallment(tx, payment.installmentId);
      const note = !installment || installment.billStatus === 'void' ? 'bill_void' : installment.paidAt ? 'paid_twice' : null;
      await updatePayment(tx, payment.id, { status: 'paid', paidAt: at, providerTxnId: e.providerTxnId, lastError: note });
      if (installment && !note) {
        await markInstallmentPaid(tx, installment.id, at);
        if ((await unpaidInstallments(tx, installment.billId)) === 0) await markBillPaid(tx, installment.billId, at);
      }
    });
    await markWebhookProcessed(row.id);
    applied += 1;
  }
  return { applied };
}
