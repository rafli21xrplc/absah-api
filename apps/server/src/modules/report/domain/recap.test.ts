import { describe, expect, it } from 'vitest';
import { addCounts, emptyCounts, recapTotals, summarizeCompliance, type ComplianceRow } from './recap';

describe('recapTotals', () => {
  it('counts H and T as present', () => {
    expect(recapTotals({ H: 15, T: 3, S: 1, I: 0, A: 1 })).toEqual({ counts: { H: 15, T: 3, S: 1, I: 0, A: 1 }, days: 20, presentRate: 0.9 });
  });

  it('has no rate without days', () => {
    expect(recapTotals(emptyCounts())).toMatchObject({ days: 0, presentRate: null });
  });

  it('rounds the rate to four decimals', () => {
    expect(recapTotals({ H: 2, T: 0, S: 1, I: 0, A: 0 }).presentRate).toBe(0.6667);
  });

  it('adds counts', () => {
    expect(addCounts({ H: 1, T: 0, S: 2, I: 0, A: 0 }, { H: 3, T: 1, S: 0, I: 1, A: 1 })).toEqual({ H: 4, T: 1, S: 2, I: 1, A: 1 });
  });
});

describe('summarizeCompliance', () => {
  const row = (teacherId: string | null, date: string, c: Partial<ComplianceRow>): ComplianceRow => ({
    teacherId,
    date,
    sessions: 0,
    filled: 0,
    filledLate: 0,
    missed: 0,
    open: 0,
    ...c,
  });

  const rows = [
    row('a', '2027-01-11', { sessions: 4, filled: 4, filledLate: 1 }),
    row('a', '2027-01-12', { sessions: 4, filled: 3, missed: 1 }),
    row('b', '2027-01-11', { sessions: 2, missed: 2 }),
    row('b', '2027-01-12', { sessions: 2, filled: 1, open: 1 }),
    row(null, '2027-01-12', { sessions: 1, open: 1 }),
  ];

  it('totals every session and leaves open ones out of the rate', () => {
    expect(summarizeCompliance(rows).totals).toEqual({ sessions: 13, filled: 8, filledLate: 1, missed: 3, open: 2, fillRate: 0.7273 });
  });

  it('lists teachers worst first, nothing due last', () => {
    const { teachers } = summarizeCompliance(rows);
    expect(teachers.map((t) => [t.teacherId, t.fillRate])).toEqual([
      ['b', 0.3333],
      ['a', 0.875],
      [null, null],
    ]);
  });

  it('lists days in date order', () => {
    const { days } = summarizeCompliance(rows);
    expect(days.map((d) => [d.date, d.sessions, d.missed])).toEqual([
      ['2027-01-11', 6, 2],
      ['2027-01-12', 7, 1],
    ]);
  });

  it('is empty without sessions', () => {
    expect(summarizeCompliance([])).toEqual({ totals: { sessions: 0, filled: 0, filledLate: 0, missed: 0, open: 0, fillRate: null }, teachers: [], days: [] });
  });
});
