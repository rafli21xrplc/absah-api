import type { BillInstallmentInput } from '@absah/contracts';

export interface PlannedInstallment {
  number: number;
  amount: number;
  dueOn: string;
}

/**
 * The parts of a bill (TGH-02). Without a plan: one part, the whole amount, on the due date. With one: the parts add up
 * to the amount exactly, none is due before the one before it, and the bill is due on the last. Returns the message of
 * the first problem instead of throwing, so the caller picks the error type.
 */
export function planInstallments(total: number, dueOn: string | undefined, parts: BillInstallmentInput[] | undefined): { ok: true; items: PlannedInstallment[]; dueOn: string } | { ok: false; message: string } {
  if (!parts) {
    if (!dueOn) return { ok: false, message: 'Isi tanggal jatuh tempo.' };
    return { ok: true, items: [{ number: 1, amount: total, dueOn }], dueOn };
  }
  const sum = parts.reduce((n, p) => n + p.amount, 0);
  if (sum !== total) return { ok: false, message: `Cicilan berjumlah ${sum}, harus sama dengan tagihan ${total}.` };
  for (let i = 1; i < parts.length; i++) {
    if ((parts[i] as BillInstallmentInput).dueOn < (parts[i - 1] as BillInstallmentInput).dueOn) return { ok: false, message: 'Jatuh tempo cicilan harus berurutan.' };
  }
  const last = (parts[parts.length - 1] as BillInstallmentInput).dueOn;
  return { ok: true, items: parts.map((p, i) => ({ number: i + 1, amount: p.amount, dueOn: p.dueOn })), dueOn: last };
}

/** Rupiah paid so far, from the installments' paid flags. */
export const paidAmount = (items: { amount: number; paidAt: unknown }[]): number => items.reduce((n, i) => (i.paidAt ? n + i.amount : n), 0);

/** Open, with a part past its due date still unpaid. */
export const isOverdue = (status: string, items: { dueOn: string; paidAt: unknown }[], today: string): boolean => status === 'open' && items.some((i) => !i.paidAt && i.dueOn < today);
