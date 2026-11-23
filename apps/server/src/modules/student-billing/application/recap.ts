import type { BillingRecap, BillingRecapQuery } from '@absah/contracts';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { NotFoundError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { findSchool } from '../../attendance';
import { canReadStudentBills } from '../domain/policies';
import { mergeRecap, monthRange } from '../domain/recap';
import { findFeeType } from '../infrastructure/fee-repo';
import { billsPerClass, installmentsPerClass, receivedPerDay } from '../infrastructure/recap-repo';

/**
 * GET /student-billing/recap (TGH-04): the month's receipts (money the gateway confirmed, by day and method, with the
 * ones that counted for nothing flagged) and what is owed per rombel as of today. Read-only; the numbers come from the
 * same rows the bills show, so the two never disagree.
 */
export function billingRecap(actor: Actor, today: string, query: BillingRecapQuery): Promise<BillingRecap> {
  authorize(actor, canReadStudentBills);
  const month = query.month ?? today.slice(0, 7);
  const { from, to } = monthRange(month);
  return withTenant({ schoolId: actor.schoolId, userId: actor.userId }, async (tx) => {
    if (query.feeTypeId && !(await findFeeType(tx, query.feeTypeId))) throw new NotFoundError('Jenis tagihan tidak ditemukan.');
    const timezone = (await findSchool(tx, actor.schoolId))?.timezone ?? 'Asia/Jakarta';
    // One after the other: a transaction has one connection.
    const received = await receivedPerDay(tx, from, to, timezone, query.feeTypeId);
    const owed = mergeRecap(await billsPerClass(tx, query.feeTypeId), await installmentsPerClass(tx, today, query.feeTypeId));
    const days = new Map<string, { count: number; amount: number }>();
    for (const r of received) {
      const d = days.get(r.day) ?? { count: 0, amount: 0 };
      days.set(r.day, { count: d.count + r.count, amount: d.amount + r.amount });
    }
    const by = (method: 'va' | 'qris') => received.filter((r) => r.method === method).reduce((n, r) => n + r.amount, 0);
    return {
      month,
      received: {
        count: received.reduce((n, r) => n + r.count, 0),
        amount: received.reduce((n, r) => n + r.amount, 0),
        va: by('va'),
        qris: by('qris'),
        flagged: received.reduce((n, r) => n + r.flagged, 0),
        days: [...days].map(([date, d]) => ({ date, ...d })).sort((a, b) => a.date.localeCompare(b.date)),
      },
      bills: { ...owed.totals, classes: owed.classes.map((c) => ({ classId: c.classId, className: c.className, count: c.count, billed: c.billed, paid: c.paid, outstanding: c.outstanding, overdue: c.overdue })) },
    };
  });
}
