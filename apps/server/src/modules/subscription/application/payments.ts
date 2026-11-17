import type { CreatePaymentRequest, Payment, PaymentList } from '@absah/contracts';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withPlatform, withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError } from '../../../shared/errors';
import { defineConsumer, emit, markWebhookProcessed, recordWebhook, type Consumer } from '../../../shared/outbox';
import type { Actor } from '../../../shared/policy';
import { PaymentError, type PaymentEvent, type PaymentProvider } from '../../../shared/payments';
import { canPayBilling, canReadBilling } from '../domain/policies';
import {
  insertPayment,
  invoiceForPayment,
  lockPayment,
  markInvoicePaid,
  openPayments,
  paymentByProviderRef,
  paymentsOf,
  pendingPaymentWebhooks,
  updatePayment,
  type PaymentRow,
} from '../infrastructure/payment-repo';
import { findInvoice } from '../infrastructure/invoice-repo';

/** How long a VA / QRIS stays payable. */
export const PAYMENT_VALID_HOURS = 24;
/** A webhook for a charge we cannot find (create still committing) waits this long, then is dropped. */
const ORPHAN_AFTER_MS = 24 * 60 * 60_000;

const tenant = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
export const inboxProvider = (provider: PaymentProvider) => `payment:${provider.name}`;

/** A pending charge past its expiry reads as expired (the gateway's own webhook may come later). */
function toPayment(row: PaymentRow, now: Date): Payment {
  const expired = row.status === 'pending' && row.expiresAt !== null && row.expiresAt <= now;
  return {
    id: row.id,
    invoiceId: row.invoiceId,
    method: row.method,
    status: expired ? 'expired' : row.status,
    amount: row.amount,
    vaBank: row.vaBank,
    vaNumber: row.vaNumber,
    qrString: row.qrString,
    expiresAt: row.expiresAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null,
    error: row.error,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * POST /billing/invoices/{id}/payments (admin). Reuses an open attempt of the same method; otherwise
 * stores a requested payment and leaves the gateway call to the worker (CLAUDE.md rule 3).
 */
export async function requestPayment(actor: Actor, auditCtx: AuditContext, provider: PaymentProvider | null, invoiceId: string, input: CreatePaymentRequest, now = new Date()): Promise<Payment> {
  authorize(actor, canPayBilling);
  if (!provider) throw new ConflictError('Pembayaran online belum tersedia. Hubungi tim Absah untuk cara bayar.', { reason: 'payments_unavailable' });
  return withTenant(tenant(actor), async (tx) => {
    const invoice = await invoiceForPayment(tx, invoiceId);
    if (!invoice) throw new NotFoundError('Tagihan tidak ditemukan.');
    if (invoice.status === 'paid') throw new ConflictError('Tagihan ini sudah lunas.', { reason: 'already_paid' });
    if (invoice.status !== 'issued') throw new ConflictError('Tagihan ini dibatalkan.', { reason: 'invoice_void' });
    const open = (await openPayments(tx, invoiceId)).find((p) => p.method === input.method && p.provider === provider.name && !(p.expiresAt && p.expiresAt <= now));
    if (open) return toPayment(open, now);
    const row = await insertPayment(tx, { schoolId: actor.schoolId, invoiceId, provider: provider.name, method: input.method, amount: invoice.total, requestedBy: actor.userId });
    await audit(tx, auditCtx, 'billing.payment_requested', { type: 'payment', id: row.id }, { after: { invoiceId, method: input.method, amount: invoice.total } });
    await emit(tx, 'payment.requested', { paymentId: row.id });
    return toPayment(row, now);
  });
}

export function paymentsFor(actor: Actor, invoiceId: string, now = new Date()): Promise<PaymentList> {
  authorize(actor, canReadBilling);
  return withTenant(tenant(actor), async (tx) => {
    if (!(await findInvoice(tx, invoiceId))) throw new NotFoundError('Tagihan tidak ditemukan.');
    return { items: (await paymentsOf(tx, invoiceId)).map((r) => toPayment(r, now)) };
  });
}

/**
 * Worker: opens the VA / QRIS at the gateway. The payment id is the gateway's external id, so a retry
 * after a crash gets the same charge. Retryable errors throw until the last attempt, then failed.
 */
export function subscriptionConsumers(provider: PaymentProvider | null, now: () => Date = () => new Date()): Consumer[] {
  if (!provider) return [];
  const open = defineConsumer({
    name: 'subscription_open_payment',
    event: 'payment.requested',
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
          description: 'Tagihan Absah',
          expiresAt: new Date(at.getTime() + PAYMENT_VALID_HOURS * 3_600_000),
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

/** Stores each verified webhook event once (provider transaction id), for the job to apply. */
export async function recordPaymentEvents(provider: PaymentProvider, events: PaymentEvent[]): Promise<number> {
  let stored = 0;
  for (const e of events) {
    const { duplicate } = await recordWebhook(inboxProvider(provider), `${e.providerTxnId}:${e.status}`, { ...e, at: e.at.toISOString() });
    if (!duplicate) stored += 1;
  }
  return stored;
}

/**
 * Job bil.apply-payments: applies stored gateway events. The school is unknown until the charge is
 * found, so the inbox read and that lookup use withPlatform (webhook inbox maintenance); the change
 * runs in the school's withTenant. A paid event is recorded once (state check + unique
 * provider_txn_id); money below the amount due leaves the invoice open.
 */
export async function applyPaymentWebhooks(provider: PaymentProvider, now = new Date(), limit = 200): Promise<{ applied: number; waiting: number }> {
  // withPlatform: inbox_webhooks is a platform table and the payment's school is not known yet.
  const rows = await withPlatform((tx) => pendingPaymentWebhooks(tx, inboxProvider(provider), limit));
  let applied = 0;
  let waiting = 0;
  for (const row of rows) {
    const e = row.payload as { providerRef: string; providerTxnId: string; status: PaymentEvent['status']; amount: number; at: string };
    const target = await withPlatform((tx) => paymentByProviderRef(tx, provider.name, e.providerRef));
    if (!target) {
      if (now.getTime() - row.receivedAt.getTime() > ORPHAN_AFTER_MS) await markWebhookProcessed(row.id);
      else waiting += 1;
      continue;
    }
    await withTenant({ schoolId: target.schoolId, userId: null }, async (tx) => {
      const payment = await lockPayment(tx, target.id);
      if (!payment || payment.status === 'paid') return;
      if (e.status !== 'paid') {
        await updatePayment(tx, payment.id, { status: e.status, lastError: e.status === 'failed' ? 'gateway_failed' : null });
        return;
      }
      const at = new Date(e.at);
      if (e.amount < payment.amount) {
        await updatePayment(tx, payment.id, { lastError: `underpaid:${e.amount}` });
        return;
      }
      await updatePayment(tx, payment.id, { status: 'paid', paidAt: at, providerTxnId: e.providerTxnId, lastError: null });
      await markInvoicePaid(tx, payment.invoiceId, at);
    });
    await markWebhookProcessed(row.id);
    applied += 1;
  }
  return { applied, waiting };
}
