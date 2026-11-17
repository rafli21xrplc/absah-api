import type { AttendanceCounts, ExportFormat, ExportTarget } from '@absah/contracts';
import { addCounts, emptyCounts } from './recap';

/** Everything an exporter needs for one semester; built by the use case, formatted by a ReportExporter. */
export interface SemesterRecap {
  school: { name: string; npsn: string | null };
  semester: { academicYear: string; number: number; startsOn: string; endsOn: string };
  /** Kepala sekolah signing the archive copy; null leaves the name line empty. */
  principalName: string | null;
  /** Date written above the signatures (school date the file was made). */
  signedOn: string;
  classes: SemesterRecapClass[];
}

export interface SemesterRecapClass {
  name: string;
  grade: number;
  homeroomName: string | null;
  students: SemesterRecapStudent[];
}

export interface SemesterRecapStudent {
  name: string;
  nisn: string | null;
  localId: string | null;
  counts: AttendanceCounts;
}

/**
 * Formats a semester rekap for one report system (CLAUDE.md: e-Rapor now, RDM in prompt 5.5).
 * xlsx is the file the system imports; pdf is the archive copy signed by wali kelas and kepala sekolah.
 */
export interface ReportExporter {
  target: ExportTarget;
  build(recap: SemesterRecap, format: ExportFormat): Promise<Buffer>;
}

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
};

/** One enrollment of the semester's year with its rekap days inside the semester. */
export interface EnrollmentDays {
  studentId: string;
  name: string;
  nisn: string | null;
  localId: string | null;
  classId: string;
  startsOn: string;
  /** Enrollment status; moved and left mean the student is no longer at the school. */
  status: 'active' | 'moved' | 'left' | 'class_changed';
  counts: AttendanceCounts;
}

/**
 * The report card counts a student's whole semester under the rombel they ended it in: days of every
 * enrollment of the year are summed and placed in the latest one. Students whose latest enrollment
 * ended because they left the school (moved, left) are not on any rombel's report.
 */
export function semesterStudentsByClass(rows: readonly EnrollmentDays[]): Map<string, SemesterRecapStudent[]> {
  const byStudent = new Map<string, EnrollmentDays[]>();
  for (const r of rows) byStudent.set(r.studentId, [...(byStudent.get(r.studentId) ?? []), r]);
  const byClass = new Map<string, SemesterRecapStudent[]>();
  for (const enrollments of byStudent.values()) {
    const latest = enrollments.reduce((a, b) => (b.startsOn > a.startsOn ? b : a));
    if (latest.status === 'moved' || latest.status === 'left') continue;
    const counts = enrollments.reduce((sum, e) => addCounts(sum, e.counts), emptyCounts());
    const list = byClass.get(latest.classId) ?? [];
    list.push({ name: latest.name, nisn: latest.nisn, localId: latest.localId, counts });
    byClass.set(latest.classId, list);
  }
  for (const list of byClass.values()) list.sort((a, b) => a.name.localeCompare(b.name, 'id'));
  return byClass;
}

/** e.g. "rekap-kehadiran-2026-2027-sem2-X-1.xlsx"; "semua-rombel" without a rombel. */
export function exportFileName(recap: Pick<SemesterRecap, 'semester'>, className: string | null, format: ExportFormat): string {
  const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'rombel';
  return `rekap-kehadiran-${slug(recap.semester.academicYear)}-sem${recap.semester.number}-${className ? slug(className) : 'semua-rombel'}.${format}`;
}
