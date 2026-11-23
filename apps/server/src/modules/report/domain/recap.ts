import { ATTENDANCE_STATUSES, type AttendanceCounts, type AttendanceStatus } from '@absah/contracts';

/** Pure rekap arithmetic (RKP-01, RKP-02, RKP-04): no I/O, unit tested next to this file. */

export function emptyCounts(): AttendanceCounts {
  return Object.fromEntries(ATTENDANCE_STATUSES.map((s) => [s, 0])) as Record<AttendanceStatus, number>;
}

export interface RecapTotals {
  counts: AttendanceCounts;
  days: number;
  presentRate: number | null;
}

/** Days with a status, and the share of them present (H or T, terlambat still attended). */
export function recapTotals(counts: AttendanceCounts): RecapTotals {
  const days = ATTENDANCE_STATUSES.reduce((sum, s) => sum + (counts[s] ?? 0), 0);
  const present = (counts.H ?? 0) + (counts.T ?? 0);
  return { counts, days, presentRate: days === 0 ? null : round(present / days) };
}

export function addCounts(into: AttendanceCounts, more: AttendanceCounts): AttendanceCounts {
  for (const s of ATTENDANCE_STATUSES) into[s] = (into[s] ?? 0) + (more[s] ?? 0);
  return into;
}

/** One group of sessions (a teacher on a day) as counted by the database. */
export interface ComplianceRow {
  teacherId: string | null;
  date: string;
  sessions: number;
  filled: number;
  filledLate: number;
  missed: number;
  open: number;
}

export interface ComplianceCounts {
  sessions: number;
  filled: number;
  filledLate: number;
  missed: number;
  open: number;
  fillRate: number | null;
}

function withRate(c: Omit<ComplianceCounts, 'fillRate'>): ComplianceCounts {
  const due = c.sessions - c.open;
  return { ...c, fillRate: due <= 0 ? null : round(c.filled / due) };
}

const zero = () => ({ sessions: 0, filled: 0, filledLate: 0, missed: 0, open: 0 });

function bucket<K>(map: Map<K, Omit<ComplianceCounts, 'fillRate'>>, key: K) {
  let counts = map.get(key);
  if (!counts) map.set(key, (counts = zero()));
  return counts;
}

function add(into: Omit<ComplianceCounts, 'fillRate'>, row: ComplianceRow) {
  into.sessions += row.sessions;
  into.filled += row.filled;
  into.filledLate += row.filledLate;
  into.missed += row.missed;
  into.open += row.open;
}

/**
 * RKP-04: totals, per teacher (lowest fill rate first, then most missed) and per day (by date).
 * Open sessions are not due yet, so they do not lower the fill rate.
 */
export function summarizeCompliance(rows: readonly ComplianceRow[]) {
  const totals = zero();
  const teachers = new Map<string | null, Omit<ComplianceCounts, 'fillRate'>>();
  const days = new Map<string, Omit<ComplianceCounts, 'fillRate'>>();
  for (const row of rows) {
    add(totals, row);
    add(bucket(teachers, row.teacherId), row);
    add(bucket(days, row.date), row);
  }
  const rate = (c: ComplianceCounts) => c.fillRate ?? 2; // nothing due sorts last
  return {
    totals: withRate(totals),
    teachers: [...teachers]
      .map(([teacherId, c]) => ({ teacherId, ...withRate(c) }))
      .sort((a, b) => rate(a) - rate(b) || b.missed - a.missed),
    days: [...days]
      .map(([date, c]) => ({ date, ...withRate(c) }))
      .sort((a, b) => a.date.localeCompare(b.date)),
  };
}

const round = (n: number) => Math.round(n * 10_000) / 10_000;
