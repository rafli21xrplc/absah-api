import { DASHBOARD_AT_RISK_LIMIT, type AttendanceCounts, type EarlyWarning, type EarlyWarningKind } from '@absah/contracts';
import { recapTotals } from './recap';

/** Pure arithmetic of the principal dashboard (RKP-05); unit tested next to this file. */

export interface DayCounts {
  date: string;
  counts: AttendanceCounts;
}

/** Oldest first, one point per date that has rekap rows. */
export function attendanceTrend(rows: readonly DayCounts[]) {
  return [...rows]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((r) => {
      const totals = recapTotals(r.counts);
      return { date: r.date, presentRate: totals.presentRate, days: totals.days };
    })
    .filter((p) => p.days > 0);
}

/**
 * Warnings of the last days folded per student: the kinds raised (each once), the latest date, and the students with the
 * most kinds first (then the most recent, then by name). `students` counts all of them, `items` only the first few.
 */
export function atRiskStudents(warnings: readonly EarlyWarning[], limit = DASHBOARD_AT_RISK_LIMIT) {
  const byStudent = new Map<string, { enrollmentId: string; name: string; className: string; kinds: Set<EarlyWarningKind>; lastDate: string }>();
  for (const w of warnings) {
    const entry = byStudent.get(w.student.enrollmentId) ?? { ...w.student, kinds: new Set<EarlyWarningKind>(), lastDate: w.date };
    entry.kinds.add(w.kind);
    if (w.date > entry.lastDate) entry.lastDate = w.date;
    byStudent.set(w.student.enrollmentId, entry);
  }
  const ranked = [...byStudent.values()].sort((a, b) => b.kinds.size - a.kinds.size || b.lastDate.localeCompare(a.lastDate) || a.name.localeCompare(b.name, 'id'));
  return { students: ranked.length, items: ranked.slice(0, limit).map((r) => ({ ...r, kinds: [...r.kinds] })) };
}
