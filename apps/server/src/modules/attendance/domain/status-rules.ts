import type { AttendanceSource, AttendanceStatus } from '@absah/contracts';

/**
 * Which source wins when two write the same student in the same session (PRS-02).
 * - manual: a correction a wakasek approved (PRS-05), the final word.
 * - leave: an approved izin; a teacher cannot turn it into alpa (izin > guru).
 * - uks: sent home from UKS marks the rest of the day sakit; the teacher does not overwrite it.
 * - pkl_confirm: the school mentor's decision on a PKL day, above the teacher.
 * - teacher: what the teacher fills in, above the gate (guru > gerbang): the gate only pre-fills.
 * - gate: a QR scan at the gate.
 * A source may always overwrite itself (a teacher refilling the session, a later gate scan).
 */
export const SOURCE_PRIORITY: Record<AttendanceSource, number> = {
  manual: 6,
  leave: 5,
  uks: 4,
  pkl_confirm: 3,
  teacher: 2,
  gate: 1,
};

export interface SourcedStatus {
  status: AttendanceStatus;
  source: AttendanceSource;
}

/** True when `incoming` should replace the stored record. */
export function shouldReplace(existing: SourcedStatus | null | undefined, incoming: SourcedStatus): boolean {
  if (!existing) return true;
  return SOURCE_PRIORITY[incoming.source] >= SOURCE_PRIORITY[existing.source];
}

/** The record that stands after applying writes in order. */
export function applyWrites(writes: SourcedStatus[]): SourcedStatus | null {
  return writes.reduce<SourcedStatus | null>((current, w) => (shouldReplace(current, w) ? w : current), null);
}

const ABSENCE_ORDER: AttendanceStatus[] = ['S', 'I', 'A'];

/**
 * The status of a student for the whole school day from the records of that day's sessions.
 * - present (H or T) in any session: H, or T when any session says T;
 * - absent in all: the most frequent of S, I, A, ties go S before I before A;
 * - no records: null (nothing known).
 * In daily mode there is one session, so the day takes its status.
 */
export function computeDailyStatus(records: Pick<SourcedStatus, 'status'>[]): AttendanceStatus | null {
  if (records.length === 0) return null;
  const present = records.filter((r) => r.status === 'H' || r.status === 'T');
  if (present.length > 0) return present.some((r) => r.status === 'T') ? 'T' : 'H';
  const counts = new Map<AttendanceStatus, number>();
  for (const r of records) counts.set(r.status, (counts.get(r.status) ?? 0) + 1);
  return ABSENCE_ORDER.reduce((best, s) => ((counts.get(s) ?? 0) > (counts.get(best) ?? 0) ? s : best), 'S' as AttendanceStatus);
}

/** ISO weekday of a YYYY-MM-DD date: 1 = Senin ... 7 = Minggu. */
export function isoWeekday(date: string): number {
  const day = new Date(`${date}T00:00:00Z`).getUTCDay();
  return day === 0 ? 7 : day;
}

/**
 * Whether sessions are generated on `date`. The school calendar decides first (holiday, or a
 * make-up school_day); otherwise weekdays with jam pelajaran configured, or Senin-Jumat when the
 * school has none (SD often runs on wali kelas alone).
 */
export function isSchoolDay(input: {
  date: string;
  calendarKind: 'holiday' | 'school_day' | null;
  daysWithPeriods: ReadonlySet<number>;
}): { schoolDay: boolean; reason: 'holiday' | 'not_school_day' | null } {
  if (input.calendarKind === 'holiday') return { schoolDay: false, reason: 'holiday' };
  if (input.calendarKind === 'school_day') return { schoolDay: true, reason: null };
  const day = isoWeekday(input.date);
  const usual = input.daysWithPeriods.size > 0 ? input.daysWithPeriods.has(day) : day <= 5;
  return usual ? { schoolDay: true, reason: null } : { schoolDay: false, reason: 'not_school_day' };
}
