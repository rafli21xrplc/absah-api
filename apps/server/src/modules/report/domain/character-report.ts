import { KAIH_HABITS, type AttendanceCounts, type HabitCode } from '@absah/contracts';
import { addCounts, emptyCounts, recapTotals } from './recap';
import type { EnrollmentDays } from './semester-recap';

/** The semester character report (KEG-04): everything one page per student shows. Built by the use case, drawn by the PDF exporter. */

export interface HabitTotal {
  habit: HabitCode;
  yes: number;
  filled: number;
}

export interface ActivityTotal {
  name: string;
  kind: string;
  recorded: number;
  present: number;
}

export interface CharacterStudent {
  name: string;
  nisn: string | null;
  counts: AttendanceCounts;
  presentRate: number | null;
  achievementPoints: number;
  violationPoints: number;
  habits: HabitTotal[];
  activities: ActivityTotal[];
}

export interface CharacterReport {
  school: { name: string; npsn: string | null };
  semester: { academicYear: string; number: number; startsOn: string; endsOn: string };
  className: string;
  homeroomName: string | null;
  principalName: string | null;
  /** 'Kepala Sekolah' or 'Kepala Madrasah'. */
  principalTitle: string;
  signedOn: string;
  students: CharacterStudent[];
}

/** Indonesian names of the 7 KAIH habits; beribadah is the ibadah line of the report. */
export const HABIT_LABELS: Record<HabitCode, string> = {
  bangun_pagi: 'Bangun pagi',
  beribadah: 'Beribadah',
  berolahraga: 'Berolahraga',
  makan_sehat: 'Makan sehat dan bergizi',
  gemar_belajar: 'Gemar belajar',
  bermasyarakat: 'Bermasyarakat',
  tidur_cepat: 'Tidur cepat',
};

/** Share of filled days a habit was done, null when it was never filled (the report then says "belum diisi", not 0%). */
export function habitRate(h: Pick<HabitTotal, 'yes' | 'filled'>): number | null {
  return h.filled === 0 ? null : Math.round((h.yes / h.filled) * 100) / 100;
}

/** A word for a share, for the line under the percentages: the report is read by parents, not analysts. */
export function habitPredicate(rate: number | null): string {
  if (rate === null) return 'Belum diisi';
  if (rate >= 0.9) return 'Sangat baik';
  if (rate >= 0.75) return 'Baik';
  if (rate >= 0.5) return 'Cukup';
  return 'Perlu dibina';
}

export interface RosterStudent {
  name: string;
  nisn: string | null;
  enrollmentIds: string[];
  counts: AttendanceCounts;
}

/**
 * Students of one rombel for the semester. As in the rekap, a student belongs to the rombel they ended the semester in (their
 * latest enrollment) and all their enrollments of the year count; students who left the school are on no report. Alphabetical.
 */
export function characterRoster(rows: readonly (EnrollmentDays & { enrollmentId: string })[], classId: string): RosterStudent[] {
  const byStudent = new Map<string, (EnrollmentDays & { enrollmentId: string })[]>();
  for (const r of rows) byStudent.set(r.studentId, [...(byStudent.get(r.studentId) ?? []), r]);
  const roster: RosterStudent[] = [];
  for (const list of byStudent.values()) {
    const latest = list.reduce((a, b) => (b.startsOn > a.startsOn ? b : a));
    if (latest.classId !== classId || latest.status === 'moved' || latest.status === 'left') continue;
    roster.push({ name: latest.name, nisn: latest.nisn, enrollmentIds: list.map((e) => e.enrollmentId), counts: list.reduce((sum, e) => addCounts(sum, e.counts), emptyCounts()) });
  }
  return roster.sort((a, b) => a.name.localeCompare(b.name, 'id'));
}

/** Adds the habit tallies of several enrollments of one student; always all 7 habits, in the order of KAIH_HABITS. */
export function sumHabits(tallies: readonly (readonly HabitTotal[])[]): HabitTotal[] {
  return KAIH_HABITS.map((habit) => {
    const own = tallies.flatMap((t) => t.filter((x) => x.habit === habit));
    return { habit, yes: own.reduce((n, x) => n + x.yes, 0), filled: own.reduce((n, x) => n + x.filled, 0) };
  });
}

/** The same activity across a student's enrollments is one line (names are unique per year). */
export function mergeActivities(lists: readonly (readonly (ActivityTotal & { activityId: string })[])[]): ActivityTotal[] {
  const byId = new Map<string, ActivityTotal>();
  for (const a of lists.flat()) {
    const entry = byId.get(a.activityId) ?? { name: a.name, kind: a.kind, recorded: 0, present: 0 };
    entry.recorded += a.recorded;
    entry.present += a.present;
    byId.set(a.activityId, entry);
  }
  return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name, 'id'));
}

export const presentRateOf = (counts: AttendanceCounts): number | null => recapTotals(counts).presentRate;

/** e.g. "rapor-karakter-2026-2027-sem1-X-1.pdf". */
export function characterFileName(report: Pick<CharacterReport, 'semester' | 'className'>): string {
  const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'rombel';
  return `rapor-karakter-${slug(report.semester.academicYear)}-sem${report.semester.number}-${slug(report.className)}.pdf`;
}
