import { describe, expect, it } from 'vitest';
import { computeInvoice, daysInMonth, monthRange, previousMonth, type EnrollmentPeriod } from './invoice';

const range = (from: string, to: string): string[] => {
  const out: string[] = [];
  for (let d = new Date(`${from}T00:00:00Z`); d <= new Date(`${to}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1)) out.push(d.toISOString().slice(0, 10));
  return out;
};
const e = (studentId: string, from: string, to: string | null = null): EnrollmentPeriod => ({ studentId, from, to });

/** Hand-counted cases (docs/prompts.md prompt 4.3: 15 cases incl. joiners, leavers, leap February, partial year-end break). */
const CASES: { name: string; month: string; enrollments: EnrollmentPeriod[]; exempt?: string[]; days: number[]; total: number }[] = [
  { name: 'full month of 31 days', month: '2027-01', enrollments: [e('a', '2026-07-13')], days: [31], total: 10_000 },
  { name: 'full month of 30 days', month: '2027-04', enrollments: [e('a', '2026-07-13')], days: [30], total: 10_000 },
  { name: 'active 10 of 31 days (the rule example)', month: '2027-01', enrollments: [e('a', '2026-07-13', '2027-01-10')], days: [10], total: 3_226 }, // 100000/31 = 3225.81
  { name: 'joins mid-month (16th of 31)', month: '2027-01', enrollments: [e('a', '2027-01-16')], days: [16], total: 5_161 }, // 160000/31 = 5161.29
  { name: 'leaves mid-month (until the 15th of 30)', month: '2027-04', enrollments: [e('a', '2026-07-13', '2027-04-15')], days: [15], total: 5_000 },
  { name: 'joins and leaves in the same month', month: '2027-03', enrollments: [e('a', '2027-03-05', '2027-03-09')], days: [5], total: 1_613 }, // 50000/31 = 1612.90
  { name: 'leap February, whole month', month: '2028-02', enrollments: [e('a', '2027-07-12')], days: [29], total: 10_000 },
  { name: 'leap February, joins on the 15th', month: '2028-02', enrollments: [e('a', '2028-02-15')], days: [15], total: 5_172 }, // 150000/29 = 5172.41
  { name: 'non-leap February, 14 of 28 days', month: '2027-02', enrollments: [e('a', '2026-07-13', '2027-02-14')], days: [14], total: 5_000 },
  {
    name: 'year-end break exempt from 21 June (partial month)',
    month: '2027-06',
    enrollments: [e('a', '2026-07-13', '2027-06-30'), e('b', '2026-07-13', '2027-06-30')],
    exempt: range('2027-06-21', '2027-06-30'),
    days: [20, 20],
    total: 13_333, // 400000/30 = 13333.33
  },
  { name: 'whole month exempt (July break)', month: '2027-07', enrollments: [e('a', '2027-07-01')], exempt: range('2027-07-01', '2027-07-11').concat(range('2027-07-12', '2027-07-31')), days: [], total: 0 },
  {
    name: 'exempt days after the student left change nothing',
    month: '2027-06',
    enrollments: [e('a', '2026-07-13', '2027-06-10')],
    exempt: range('2027-06-21', '2027-06-30'),
    days: [10],
    total: 3_333,
  },
  {
    name: 'class change inside the month counts each day once',
    month: '2027-01',
    enrollments: [e('a', '2026-07-13', '2027-01-12'), e('a', '2027-01-13')],
    days: [31],
    total: 10_000,
  },
  {
    name: 'overlapping enrollments (bad data) are not billed twice',
    month: '2027-01',
    enrollments: [e('a', '2026-07-13', '2027-01-20'), e('a', '2027-01-10')],
    days: [31],
    total: 10_000,
  },
  {
    name: 'rounded on the total, not per student',
    month: '2027-01',
    enrollments: [e('a', '2027-01-31'), e('b', '2027-01-31'), e('c', '2027-01-31')],
    days: [1, 1, 1],
    total: 968, // 30000/31 = 967.74; per student 322.58 -> 323 x 3 would be 969
  },
  { name: 'enrollments outside the month bill nothing', month: '2027-01', enrollments: [e('a', '2026-07-13', '2026-12-20'), e('b', '2027-02-01')], days: [], total: 0 },
];

describe('computeInvoice', () => {
  it.each(CASES)('$name', ({ month, enrollments, exempt = [], days, total }) => {
    const invoice = computeInvoice(enrollments, exempt, month);
    expect(invoice.lines.map((l) => l.days)).toEqual(days);
    expect(invoice.total).toBe(total);
    expect(invoice.billedDays).toBe(days.reduce((a, b) => a + b, 0));
  });

  it('bills 900 students for a full month at Rp9.000.000', () => {
    const enrollments = Array.from({ length: 900 }, (_, i) => e(`s${String(i).padStart(3, '0')}`, '2026-07-13'));
    expect(computeInvoice(enrollments, [], '2027-01').total).toBe(9_000_000);
  });

  it('keeps the exact share per line', () => {
    const [line] = computeInvoice([e('a', '2026-07-13', '2027-01-10')], [], '2027-01').lines;
    expect(line?.amount).toBeCloseTo(3225.8065, 4);
  });
});

describe('month helpers', () => {
  it.each([
    ['2027-01', 31],
    ['2027-02', 28],
    ['2028-02', 29],
    ['2100-02', 28],
    ['2000-02', 29],
    ['2027-04', 30],
  ])('%s has %i days', (month, n) => {
    expect(daysInMonth(month)).toBe(n);
  });

  it('gives ranges and previous months', () => {
    expect(monthRange('2028-02')).toEqual(['2028-02-01', '2028-02-29']);
    expect(previousMonth('2027-01')).toBe('2026-12');
    expect(previousMonth('2027-03')).toBe('2027-02');
  });
});
