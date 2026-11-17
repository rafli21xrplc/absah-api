import { schema, type Tx } from '@absah/db';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';

const p = schema.payments;
const inv = schema.invoices;

export async function invoiceForPayment(tx: Tx, invoiceId: string) {
  const [row] = await tx.select({ id: inv.id, status: inv.status, total: inv.total, month: inv.month }).from(inv).where(eq(inv.id, invoiceId)).for('update');
  return row ?? null;
}

const paymentColumns = {
  id: p.id,
  invoiceId: p.invoiceId,
  method: p.method,
  status: p.status,
  amount: p.amount,
  vaBank: p.vaBank,
  vaNumber: p.vaNumber,
  qrString: p.qrString,
  expiresAt: p.expiresAt,
  paidAt: p.paidAt,
  error: p.lastError,
  createdAt: p.createdAt,
  provider: p.provider,
  providerRef: p.providerRef,
};
export type PaymentRow = Awaited<ReturnType<typeof paymentsOf>>[number];

export const paymentsOf = (tx: Tx, invoiceId: string) => tx.select(paymentColumns).from(p).where(eq(p.invoiceId, invoiceId)).orderBy(desc(p.createdAt));

/** Open attempts of an invoice (still being opened or payable). */
export const openPayments = (tx: Tx, invoiceId: string) =>
  tx.select(paymentColumns).from(p).where(and(eq(p.invoiceId, invoiceId), inArray(p.status, ['requested', 'pending']))).orderBy(desc(p.createdAt));

export async function insertPayment(tx: Tx, values: typeof p.$inferInsert) {
  const [row] = await tx.insert(p).values(values).returning(paymentColumns);
  if (!row) throw new Error('payment insert returned nothing');
  return row;
}

export async function lockPayment(tx: Tx, id: string) {
  const [row] = await tx.select(paymentColumns).from(p).where(eq(p.id, id)).for('update');
  return row ?? null;
}

export async function updatePayment(tx: Tx, id: string, set: Partial<typeof p.$inferInsert>) {
  await tx.update(p).set(set).where(eq(p.id, id));
}

export async function markInvoicePaid(tx: Tx, invoiceId: string, at: Date): Promise<boolean> {
  const rows = await tx
    .update(inv)
    .set({ status: 'paid', paidAt: at })
    .where(and(eq(inv.id, invoiceId), eq(inv.status, 'issued')))
    .returning({ id: inv.id });
  return rows.length > 0;
}

/** Which school a gateway charge belongs to (cross-tenant lookup for webhook processing). */
export async function paymentByProviderRef(tx: Tx, provider: string, providerRef: string) {
  const [row] = await tx.select({ id: p.id, schoolId: p.schoolId }).from(p).where(and(eq(p.provider, provider), eq(p.providerRef, providerRef)));
  return row ?? null;
}

export function pendingPaymentWebhooks(tx: Tx, provider: string, limit: number) {
  const w = schema.inboxWebhooks;
  return tx
    .select({ id: w.id, payload: w.payload, receivedAt: w.receivedAt })
    .from(w)
    .where(and(eq(w.provider, provider), isNull(w.processedAt)))
    .orderBy(asc(w.receivedAt))
    .limit(limit);
}
