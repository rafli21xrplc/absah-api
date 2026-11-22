import { describe, expect, it } from 'vitest';
import { mergeRecap, monthRange } from './recap';

describe('monthRange', () => {
  it('runs from the first of the month to the first of the next, across a year end', () => {
    expect(monthRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-12-01' });
    expect(monthRange('2026-12')).toEqual({ from: '2026-12-01', to: '2027-01-01' });
  });
});

describe('mergeRecap', () => {
  it('subtracts what is paid, sorts the most owed first and adds up', () => {
    const { classes, totals } = mergeRecap(
      [
        { classId: 'a', className: '8A', count: 3, billed: 750_000 },
        { classId: 'b', className: '8B', count: 2, billed: 500_000 },
        { classId: 'c', className: '7A', count: 1, billed: 250_000 },
      ],
      [
        { classId: 'a', paid: 250_000, overdue: 100_000 },
        { classId: 'b', paid: 500_000, overdue: 0 },
      ],
    );
    expect(classes.map((c) => [c.className, c.outstanding, c.overdue])).toEqual([['8A', 500_000, 100_000], ['7A', 250_000, 0], ['8B', 0, 0]]);
    expect(totals).toEqual({ count: 6, billed: 1_500_000, paid: 750_000, outstanding: 750_000, overdue: 100_000 });
  });

  it('is empty with nothing billed', () => {
    expect(mergeRecap([], [])).toEqual({ classes: [], totals: { count: 0, billed: 0, paid: 0, outstanding: 0, overdue: 0 } });
  });
});
