// Maps the old project-attendance (Laravel, MySQL) tables to Absah (prompt 4.4). Pure: no I/O.
// Moves rombel, students and their current enrollment. Teachers become a re-invite list (old
// passwords are never read). Attendance history, payments and schedules stay in the old system.
import type { ClassStream, Gender } from '@absah/contracts';
import type { DumpRow, DumpTables } from './mysql-dump';

export const LEGACY_TABLES = ['type_class', 'class_room', 'teacher', 'student', 'student_class_histories', 'attendance'] as const;

export interface EtlClass {
  legacyId: string;
  name: string;
  grade: number;
  stream: ClassStream | null;
  homeroom: string | null;
}
export interface EtlStudent {
  legacyId: string;
  nisn: string;
  localId: string | null;
  name: string;
  gender: Gender | null;
  birthDate: string | null;
  className: string;
  startsOn: string;
}
export interface EtlTeacher {
  legacyId: string;
  name: string;
  nip: string | null;
  phone: string | null;
  homeroomOf: string[];
}
export interface EtlFailure {
  table: string;
  legacyId: string;
  reason: string;
  detail: string;
}
export interface EtlPlan {
  classes: EtlClass[];
  students: EtlStudent[];
  teachers: EtlTeacher[];
  failures: EtlFailure[];
  skipped: { graduated: number; existing: number; attendanceRows: number };
}

const ROMAN: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6, VII: 7, VIII: 8, IX: 9, X: 10, XI: 11, XII: 12, XIII: 13 };
const text = (v: string | null | undefined) => (v ?? '').replace(/\s+/g, ' ').trim();

/** "X" / "XI" / "10" -> grade; null when not a grade. */
export function legacyGrade(category: string): number | null {
  const c = text(category).toUpperCase();
  const n = ROMAN[c] ?? (/^\d{1,2}$/.test(c) ? Number(c) : NaN);
  return n >= 1 && n <= 13 ? n : null;
}

export function legacyStream(name: string): ClassStream | null {
  const n = name.toUpperCase();
  if (/\bM?IPA\b/.test(n)) return 'ipa';
  if (/\bIPS\b/.test(n)) return 'ips';
  if (/\bBAHASA\b/.test(n)) return 'bahasa';
  if (/\bAGAMA\b|KEAGAMAAN/.test(n)) return 'keagamaan';
  return null;
}

/** NISN was a bigint in the old schema, so leading zeros are gone: pad back to 10 digits. */
export function legacyNisn(value: string | null | undefined): string | null {
  const digits = text(value);
  if (!/^\d{1,10}$/.test(digits) || Number(digits) === 0) return null;
  return digits.padStart(10, '0');
}

/** "0812-3456 789" / "62812..." / "+62812..." -> "+62812..."; null when not an Indonesian mobile. */
export function legacyPhone(value: string | null | undefined): string | null {
  const digits = text(value).replace(/[^\d+]/g, '');
  const local = digits.replace(/^\+?62/, '0');
  return /^08\d{7,12}$/.test(local) ? `+62${local.slice(1)}` : null;
}

const legacyDate = (v: string | null | undefined) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) && !v.startsWith('0000') ? v.slice(0, 10) : null);

export function mapProjectAttendance(
  tables: DumpTables,
  options: { yearStartsOn: string; existingNisns: ReadonlySet<string> },
): EtlPlan {
  const rows = (t: string): DumpRow[] => tables.get(t) ?? [];
  const failures: EtlFailure[] = [];
  const fail = (table: string, row: DumpRow, reason: string, detail: string) => failures.push({ table, legacyId: text(row.id), reason, detail });

  const categories = new Map(rows('type_class').map((r) => [text(r.id), text(r.category)]));
  const teacherNames = new Map(rows('teacher').map((r) => [text(r.id), text(r.name)]));
  const classes = new Map<string, EtlClass>();
  const homeroomOf = new Map<string, string[]>();
  for (const r of rows('class_room')) {
    const category = categories.get(text(r.type_class_id)) ?? '';
    const grade = legacyGrade(category);
    const name = text(`${category} ${text(r.name)}`);
    if (grade === null) {
      fail('class_room', r, 'tingkat_tidak_dikenal', name || text(r.name));
      continue;
    }
    if ([...classes.values()].some((c) => c.name === name)) {
      fail('class_room', r, 'rombel_ganda', name);
      continue;
    }
    classes.set(text(r.id), { legacyId: text(r.id), name, grade, stream: legacyStream(name), homeroom: teacherNames.get(text(r.teacher_id)) ?? null });
    homeroomOf.set(text(r.teacher_id), [...(homeroomOf.get(text(r.teacher_id)) ?? []), name]);
  }

  // The open history row of the student's current rombel says since when they sit there.
  const since = new Map<string, string>();
  for (const h of rows('student_class_histories')) {
    if (h.end_date) continue;
    const start = legacyDate(h.start_date);
    if (start) since.set(`${text(h.student_id)}:${text(h.classroom_id)}`, start);
  }

  const students: EtlStudent[] = [];
  const seen = new Set<string>();
  let graduated = 0;
  let existing = 0;
  for (const r of rows('student')) {
    if (text(r.graduated) === '1') {
      graduated += 1;
      continue;
    }
    const name = text(r.name).toUpperCase();
    const nisn = legacyNisn(r.nisn);
    const cls = classes.get(text(r.classroom_id));
    if (!name) fail('student', r, 'nama_kosong', '');
    else if (!nisn) fail('student', r, 'nisn_tidak_valid', `${name}: ${text(r.nisn) || '(kosong)'}`);
    else if (seen.has(nisn)) fail('student', r, 'nisn_ganda', `${name}: ${nisn}`);
    else if (!cls) fail('student', r, 'rombel_tidak_ditemukan', `${name}: ${text(r.classroom_id) || '(kosong)'}`);
    else if (options.existingNisns.has(nisn)) {
      seen.add(nisn);
      existing += 1;
    } else {
      seen.add(nisn);
      const start = since.get(`${text(r.id)}:${cls.legacyId}`);
      students.push({
        legacyId: text(r.id),
        nisn,
        localId: text(r.student_id) || null,
        name,
        gender: r.gender === 'L' || r.gender === 'P' ? r.gender : null,
        birthDate: legacyDate(r.day_of_birth),
        className: cls.name,
        startsOn: start && start > options.yearStartsOn ? start : options.yearStartsOn,
      });
    }
  }

  const teachers = rows('teacher').map((r) => ({
    legacyId: text(r.id),
    name: text(r.name),
    nip: text(r.nip) && text(r.nip) !== '0' ? text(r.nip) : null,
    phone: legacyPhone(r.telp),
    homeroomOf: homeroomOf.get(text(r.id)) ?? [],
  }));

  return {
    classes: [...classes.values()],
    students,
    teachers,
    failures,
    skipped: { graduated, existing, attendanceRows: rows('attendance').length },
  };
}
