import type { StudentPayment } from '@absah/contracts';
import type { StudentPaymentRow } from '../infrastructure/payment-repo';

/** A pending charge past its expiry reads as expired (the gateway's own webhook may come later). */
export function toPayment(row: StudentPaymentRow, now: Date): StudentPayment {
  const expired = row.status === 'pending' && row.expiresAt !== null && row.expiresAt <= now;
  return {
    id: row.id,
    installmentId: row.installmentId,
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
