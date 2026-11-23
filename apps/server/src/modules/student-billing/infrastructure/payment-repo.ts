import { schema, type Tx } from '@absah/db';
import { and, asc, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

const sp = schema.studentPayments;
const i = schema.billInstallments;
const b = schema.studentBills;
const e = schema.enrollments;
const st = schema.students;

const columns = {
  id: sp.id,
  installmentId: sp.installmentId,
  provider: sp.provider,
  method: sp.method,
  status: sp.status,
  amount: sp.amount,
  vaBank: sp.vaBank,
  vaNumber: sp.vaNumber,
  qrString: sp.qrString,
  expiresAt: sp.expiresAt,
  paidAt: sp.paidAt,
  error: sp.lastError,
  createdAt: sp.createdAt,
};
export type StudentPaymentRow = Awaited<ReturnType<typeof paymentsOfInstallment>>[number];

/** Students the user is (siswa) or guards (orang_tua): the only ones whose bills they may see or pay. */
function mine(tx: Tx, userId: string, as: 'student' | 'parent') {
  return as === 'student'
    ? eq(st.userId, userId)
    : sql`exists (select 1 from ${schema.studentGuardians} sg join ${schema.guardians} g on g.id = sg.guardian_id where sg.student_id = ${st.id} and g.user_id = ${userId})`;
}

/** Bill ids of the user's own students (void ones left out), most recent due date first. */
export async function myBillIds(tx: Tx, userId: string, as: 'student' | 'parent'): Promise<string[]> {
  const rows = await tx
    .select({ id: b.id })
    .from(b)
    .innerJoin(e, eq(e.id, b.enrollmentId))
    .innerJoin(st, eq(st.id, e.studentId))
    .where(and(mine(tx, userId, as), sql`${b.status} <> 'void'`))
    .orderBy(desc(b.dueOn), desc(b.id))
    .limit(200);
  return rows.map((r) => r.id);
}

/** The installment and its bill, locked, when it belongs to one of the user's own students. */
export async function lockMyInstallment(tx: Tx, installmentId: string, userId: string, as: 'student' | 'parent') {
  const [row] = await tx
    .select({ id: i.id, number: i.number, amount: i.amount, paidAt: i.paidAt, billId: b.id, billStatus: b.status, title: b.title })
    .from(i)
    .innerJoin(b, eq(b.id, i.billId))
    .innerJoin(e, eq(e.id, b.enrollmentId))
    .innerJoin(st, eq(st.id, e.studentId))
    .where(and(eq(i.id, installmentId), mine(tx, userId, as)))
    .for('update', { of: i });
  return row;
}

export const paymentsOfInstallment = (tx: Tx, installmentId: string) => tx.select(columns).from(sp).where(eq(sp.installmentId, installmentId)).orderBy(desc(sp.createdAt));

/** The latest attempt of each installment, newest first wins. */
export async function latestPayments(tx: Tx, installmentIds: string[]): Promise<Map<string, StudentPaymentRow>> {
  if (installmentIds.length === 0) return new Map();
  const rows = await tx.select(columns).from(sp).where(inArray(sp.installmentId, installmentIds)).orderBy(desc(sp.createdAt), desc(sp.id));
  const latest = new Map<string, StudentPaymentRow>();
  for (const r of rows) if (!latest.has(r.installmentId)) latest.set(r.installmentId, r);
  return latest;
}

/** Attempts still being opened or payable. */
export const openPayments = (tx: Tx, installmentId: string) =>
  tx.select(columns).from(sp).where(and(eq(sp.installmentId, installmentId), inArray(sp.status, ['requested', 'pending']))).orderBy(desc(sp.createdAt));

export async function insertPayment(tx: Tx, values: { schoolId: string; installmentId: string; provider: string; method: 'va' | 'qris'; amount: number; requestedBy: string }) {
  const [row] = await tx.insert(sp).values(values).returning(columns);
  if (!row) throw new Error('student payment insert returned nothing');
  return row;
}

export async function lockPayment(tx: Tx, id: string) {
  const [row] = await tx
    .select({ ...columns, title: b.title, number: i.number })
    .from(sp)
    .innerJoin(i, eq(i.id, sp.installmentId))
    .innerJoin(b, eq(b.id, i.billId))
    .where(eq(sp.id, id))
    .for('update', { of: sp });
  return row;
}

export function updatePayment(tx: Tx, id: string, fields: Partial<{ status: 'requested' | 'pending' | 'paid' | 'expired' | 'failed'; providerRef: string; vaBank: string | null; vaNumber: string | null; qrString: string | null; expiresAt: Date; providerTxnId: string; paidAt: Date; lastError: string | null }>) {
  return tx.update(sp).set(fields).where(eq(sp.id, id));
}

/** Which school a gateway charge belongs to (cross-tenant lookup for webhook processing; run it in withPlatform). */
export async function paymentByProviderRef(tx: Tx, provider: string, providerRef: string) {
  const [row] = await tx.select({ id: sp.id, schoolId: sp.schoolId }).from(sp).where(and(eq(sp.provider, provider), eq(sp.providerRef, providerRef)));
  return row ?? null;
}

/** Gateway events stored by the API and not applied yet, oldest first (the inbox is shared with the Absah invoices). */
export function pendingWebhooks(tx: Tx, provider: string, limit: number) {
  const w = schema.inboxWebhooks;
  return tx.select({ id: w.id, payload: w.payload }).from(w).where(and(eq(w.provider, provider), isNull(w.processedAt))).orderBy(asc(w.receivedAt)).limit(limit);
}

/** The installment a payment is for, locked, with the state of its bill. */
export async function lockInstallment(tx: Tx, id: string) {
  const [row] = await tx
    .select({ id: i.id, billId: i.billId, paidAt: i.paidAt, billStatus: b.status })
    .from(i)
    .innerJoin(b, eq(b.id, i.billId))
    .where(eq(i.id, id))
    .for('update', { of: i });
  return row;
}

export function markInstallmentPaid(tx: Tx, id: string, at: Date) {
  return tx.update(i).set({ paidAt: at }).where(eq(i.id, id));
}

export async function unpaidInstallments(tx: Tx, billId: string): Promise<number> {
  const [row] = await tx.select({ n: count() }).from(i).where(and(eq(i.billId, billId), isNull(i.paidAt)));
  return row?.n ?? 0;
}

export function markBillPaid(tx: Tx, billId: string, at: Date) {
  return tx.update(b).set({ status: 'paid', paidAt: at }).where(and(eq(b.id, billId), eq(b.status, 'open')));
}
