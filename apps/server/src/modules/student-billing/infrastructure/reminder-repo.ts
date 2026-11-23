import { schema, type Tx } from '@absah/db';
import { and, asc, eq, gte, isNull, lte } from 'drizzle-orm';

const i = schema.billInstallments;
const b = schema.studentBills;

/** Unpaid installments of open bills due in the window and not reminded yet, the soonest first. */
export function dueForReminder(tx: Tx, from: string, to: string, limit: number) {
  return tx
    .select({ id: i.id })
    .from(i)
    .innerJoin(b, eq(b.id, i.billId))
    .where(and(isNull(i.paidAt), isNull(i.remindedAt), eq(b.status, 'open'), gte(i.dueOn, from), lte(i.dueOn, to)))
    .orderBy(asc(i.dueOn), asc(i.id))
    .limit(limit)
    .for('update', { of: i, skipLocked: true });
}

export function markReminded(tx: Tx, id: string, at: Date) {
  return tx.update(i).set({ remindedAt: at }).where(eq(i.id, id));
}
