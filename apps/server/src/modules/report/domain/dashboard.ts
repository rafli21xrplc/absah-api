import { DASHBOARD_AT_RISK_LIMIT, type AttendanceCounts, type CollectionDashboard, type CollectionSchoolSummary, type EarlyWarning, type EarlyWarningKind, type PrincipalDashboard } from '@absah/contracts';
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
      return { date: r.date, presentRate: totals.presentRate, present: (r.counts.H ?? 0) + (r.counts.T ?? 0), days: totals.days };
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

/** A share to four decimals, null without a denominator (same rounding as the rekap). */
const ratio = (part: number, whole: number) => (whole === 0 ? null : Math.round((part / whole) * 10_000) / 10_000);

/** One school's principal dashboard reduced to the line the collection shows. */
export function schoolSummary(schoolId: string, name: string, d: PrincipalDashboard): CollectionSchoolSummary {
  const present = (d.attendance.today.counts.H ?? 0) + (d.attendance.today.counts.T ?? 0);
  return {
    schoolId,
    name,
    schoolDate: d.schoolDate,
    attendance: { days: d.attendance.today.days, present, presentRate: d.attendance.today.presentRate },
    sessions: d.sessions,
    atRiskStudents: d.atRisk?.students ?? null,
    mbg: d.mbg ? { enrolled: d.mbg.enrolled, present: d.mbg.present } : null,
  };
}

/**
 * Puts the schools of a collection together: student-days and sessions are added up (a rate is recomputed from the sums,
 * never averaged from rates), the trend adds the schools' days per date, at-risk and MBG are summed over the schools that have them.
 */
export function combineSchools(schools: readonly CollectionSchoolSummary[], trends: readonly PrincipalDashboard['attendance']['trend'][]): Pick<CollectionDashboard, 'totals' | 'trend'> {
  const sum = <T>(items: readonly T[], pick: (item: T) => number) => items.reduce((n, item) => n + pick(item), 0);
  const days = sum(schools, (s) => s.attendance.days);
  const present = sum(schools, (s) => s.attendance.present);
  const sessions = { total: sum(schools, (s) => s.sessions.total), filled: sum(schools, (s) => s.sessions.filled), missed: sum(schools, (s) => s.sessions.missed), open: sum(schools, (s) => s.sessions.open) };
  const withRisk = schools.filter((s) => s.atRiskStudents !== null);
  const withMbg = schools.flatMap((s) => (s.mbg ? [s.mbg] : []));
  const byDate = new Map<string, { present: number; days: number }>();
  for (const point of trends.flat()) {
    const entry = byDate.get(point.date) ?? { present: 0, days: 0 };
    entry.present += point.present;
    entry.days += point.days;
    byDate.set(point.date, entry);
  }
  return {
    totals: {
      schools: schools.length,
      attendance: { days, present, presentRate: ratio(present, days) },
      sessions: { ...sessions, fillRate: ratio(sessions.filled, sessions.total - sessions.open) },
      atRiskStudents: withRisk.length === 0 ? null : sum(withRisk, (s) => s.atRiskStudents ?? 0),
      mbg: withMbg.length === 0 ? null : { enrolled: sum(withMbg, (m) => m.enrolled), present: sum(withMbg, (m) => m.present) },
    },
    trend: [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, v]) => ({ date, present: v.present, days: v.days, presentRate: ratio(v.present, v.days) })),
  };
}
