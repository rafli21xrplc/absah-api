import { describe, expect, it } from 'vitest';
import { isOverdue, paidAmount, planInstallments } from './installments';

describe('planInstallments', () => {
  it('makes one part of the whole amount without a plan', () => {
    expect(planInstallments(250_000, '2026-11-10', undefined)).toEqual({ ok: true, items: [{ number: 1, amount: 250_000, dueOn: '2026-11-10' }], dueOn: '2026-11-10' });
    expect(planInstallments(250_000, undefined, undefined)).toMatchObject({ ok: false });
  });

  it('numbers the parts of a plan and takes the last due date as the bill’s', () => {
    const plan = planInstallments(300_000, undefined, [
      { amount: 100_000, dueOn: '2026-11-10' },
      { amount: 100_000, dueOn: '2026-12-10' },
      { amount: 100_000, dueOn: '2026-12-10' },
    ]);
    expect(plan).toMatchObject({ ok: true, dueOn: '2026-12-10' });
    expect(plan.ok && plan.items.map((i) => i.number)).toEqual([1, 2, 3]);
  });

  it('refuses parts that do not add up, or that are out of order', () => {
    expect(planInstallments(300_000, undefined, [{ amount: 100_000, dueOn: '2026-11-10' }, { amount: 100_000, dueOn: '2026-12-10' }])).toEqual({ ok: false, message: 'Cicilan berjumlah 200000, harus sama dengan tagihan 300000.' });
    expect(planInstallments(200_000, undefined, [{ amount: 100_000, dueOn: '2026-12-10' }, { amount: 100_000, dueOn: '2026-11-10' }])).toEqual({ ok: false, message: 'Jatuh tempo cicilan harus berurutan.' });
  });
});

describe('paidAmount and isOverdue', () => {
  const items = [
    { amount: 100, dueOn: '2026-11-10', paidAt: new Date() },
    { amount: 200, dueOn: '2026-12-10', paidAt: null },
  ];
  it('adds the parts that are paid', () => expect(paidAmount(items)).toBe(100));
  it('is overdue only when open with an unpaid part past its date', () => {
    expect(isOverdue('open', items, '2026-12-10')).toBe(false); // due today is not late yet
    expect(isOverdue('open', items, '2026-12-11')).toBe(true);
    expect(isOverdue('paid', items, '2027-01-01')).toBe(false);
    expect(isOverdue('void', items, '2027-01-01')).toBe(false);
  });
});
