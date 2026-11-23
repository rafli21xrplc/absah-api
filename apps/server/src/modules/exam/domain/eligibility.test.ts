import { describe, expect, it } from 'vitest';
import { attendancePercent, evaluateEligibility, showPercent } from './eligibility';

const days = (H: number, T = 0, S = 0, I = 0, A = 0) => ({ H, T, S, I, A });
const rule = { minAttendance: 75, excusedCounts: true, requirePaid: false };

describe('attendancePercent', () => {
  it('counts hadir and terlambat, and sakit and izin unless the school says otherwise', () => {
    expect(attendancePercent(days(6, 1, 1, 1, 1), true)).toBe(90);
    expect(attendancePercent(days(6, 1, 1, 1, 1), false)).toBe(70);
    expect(attendancePercent(days(0, 0, 0, 0, 4), true)).toBe(0);
  });
  it('is null without a single record', () => expect(attendancePercent(days(0), true)).toBeNull());
});

describe('showPercent', () => {
  it('cuts to one decimal instead of rounding up', () => {
    expect(showPercent(74.96)).toBe(74.9);
    expect(showPercent(75)).toBe(75);
    expect(showPercent(66.666)).toBe(66.6);
  });
});

describe('evaluateEligibility', () => {
  it('lets a student at or above the minimum sit, and holds back one below it', () => {
    expect(evaluateEligibility(rule, days(15, 0, 0, 0, 5), 0)).toEqual({ eligible: true, reasons: [] }); // exactly 75
    expect(evaluateEligibility(rule, days(14, 0, 0, 0, 6), 0)).toEqual({ eligible: false, reasons: [{ kind: 'attendance', percent: 70, minimum: 75 }] });
  });

  it('does not hold a student with no record to the attendance rule', () => {
    expect(evaluateEligibility(rule, days(0), 0).eligible).toBe(true);
  });

  it('applies the paid rule only when asked for, and says how many installments are open', () => {
    expect(evaluateEligibility({ ...rule, minAttendance: null }, days(0), 2).eligible).toBe(true);
    expect(evaluateEligibility({ minAttendance: null, excusedCounts: true, requirePaid: true }, days(0), 2)).toEqual({ eligible: false, reasons: [{ kind: 'bills', unpaidInstallments: 2 }] });
    expect(evaluateEligibility({ minAttendance: null, excusedCounts: true, requirePaid: true }, days(0), 0).eligible).toBe(true);
  });

  it('gives every reason that applies', () => {
    const result = evaluateEligibility({ minAttendance: 75, excusedCounts: false, requirePaid: true }, days(1, 0, 2, 0, 1), 1);
    expect(result.eligible).toBe(false);
    expect(result.reasons.map((r) => r.kind)).toEqual(['attendance', 'bills']);
  });

  it('has no rule, no reason: everyone sits', () => {
    expect(evaluateEligibility({ minAttendance: null, excusedCounts: true, requirePaid: false }, days(0, 0, 0, 0, 20), 5).eligible).toBe(true);
  });
});
