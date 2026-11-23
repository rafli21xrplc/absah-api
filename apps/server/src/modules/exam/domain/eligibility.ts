import type { EligibilityReason } from '@absah/contracts';

export interface AttendanceCounts {
  H: number;
  T: number;
  S: number;
  I: number;
  A: number;
}
export interface ExamRule {
  minAttendance: number | null;
  excusedCounts: boolean;
  requirePaid: boolean;
}

/** Percent of the days with a record that the student was present, or null with no record at all (nothing to hold against them). */
export function attendancePercent(c: AttendanceCounts, excusedCounts: boolean): number | null {
  const total = c.H + c.T + c.S + c.I + c.A;
  if (total === 0) return null;
  const present = c.H + c.T + (excusedCounts ? c.S + c.I : 0);
  return (present * 100) / total;
}

/** Whole hundredths of the percent are cut, not rounded, so a screen never shows 75.0 for a student who has 74.96. */
export const showPercent = (percent: number): number => Math.floor(percent * 10) / 10;

/**
 * May this student sit? Every rule the school chose must hold; the reasons are those that do not. A student with no
 * attendance record is not held to the attendance rule (the data may simply be missing), and bills count only when the
 * school asked for them.
 */
export function evaluateEligibility(rule: ExamRule, counts: AttendanceCounts, unpaidInstallments: number): { eligible: boolean; reasons: EligibilityReason[] } {
  const reasons: EligibilityReason[] = [];
  if (rule.minAttendance !== null) {
    const percent = attendancePercent(counts, rule.excusedCounts);
    if (percent !== null && percent < rule.minAttendance) reasons.push({ kind: 'attendance', percent: showPercent(percent), minimum: rule.minAttendance });
  }
  if (rule.requirePaid && unpaidInstallments > 0) reasons.push({ kind: 'bills', unpaidInstallments });
  return { eligible: reasons.length === 0, reasons };
}
