import type { AttendanceStatus } from '@absah/contracts';

/** Jumlah hadir MBG (RKP-08): pure counting rules. */

export interface MbgCount {
  enrolled: number;
  present: number;
  unrecorded: number;
}

export interface MbgClassCount extends MbgCount {
  classId: string;
  name: string;
}

/** Only students in school get a meal: H and T. Sakit, izin and alpa do not. */
const PRESENT: ReadonlySet<AttendanceStatus> = new Set(['H', 'T']);

/**
 * Counts per rombel from the students enrolled that day and their rekap status (null = nothing
 * recorded yet). Every rombel appears, also one without students.
 */
export function countMbg(classes: readonly { classId: string; name: string }[], students: readonly { classId: string; status: AttendanceStatus | null }[]): MbgClassCount[] {
  const counts = new Map(classes.map((c) => [c.classId, { classId: c.classId, name: c.name, enrolled: 0, present: 0, unrecorded: 0 }]));
  for (const s of students) {
    const row = counts.get(s.classId);
    if (!row) continue;
    row.enrolled += 1;
    if (s.status === null) row.unrecorded += 1;
    else if (PRESENT.has(s.status)) row.present += 1;
  }
  return [...counts.values()];
}

export function mbgTotal(rows: readonly MbgCount[]): MbgCount {
  return rows.reduce((t, r) => ({ enrolled: t.enrolled + r.enrolled, present: t.present + r.present, unrecorded: t.unrecorded + r.unrecorded }), { enrolled: 0, present: 0, unrecorded: 0 });
}

/** "08:30" or "08:30:00" (Postgres time) -> minutes since midnight. */
export function clockMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** "08:30:00" -> "08:30". */
export const clockLabel = (time: string) => time.slice(0, 5);

/** The cutoff count is due once the school clock reaches the cutoff (later runs catch up). */
export function isCutoffDue(schoolMinutes: number, cutoffTime: string): boolean {
  return schoolMinutes >= clockMinutes(cutoffTime);
}

/** Rombel whose fresh count differs from the stored one (a correction writes only those). */
export function changedCounts<T extends MbgClassCount>(stored: ReadonlyMap<string, MbgCount>, fresh: readonly T[]): T[] {
  return fresh.filter((f) => {
    const s = stored.get(f.classId);
    return !s || s.enrolled !== f.enrolled || s.present !== f.present || s.unrecorded !== f.unrecorded;
  });
}
