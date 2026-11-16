import { findScheduleConflicts, type TimedSlot } from './schedule-conflicts';
import { normalizeName } from './student-import';

/** One lesson row of the Absah schedule template. */
export interface ScheduleRow {
  row: number;
  className: string;
  day: string;
  period: string;
  subject: string;
  teacher: string;
}

export interface ScheduleImportContext {
  classes: { id: string; name: string }[];
  subjects: { id: string; name: string }[];
  teachers: { id: string; name: string }[];
  /** "day:period" pairs with jam pelajaran configured. */
  periods: Set<string>;
  /** Slots that stay: group lessons and rombel not in the file. */
  kept: (TimedSlot & { ownerName: string })[];
  studentsOf: (owner: Pick<TimedSlot, 'ownerType' | 'ownerId'>) => ReadonlySet<string>;
}

export interface PlannedLesson extends TimedSlot {
  row: number;
  ownerName: string;
  /** Existing subject id, or null with subjectName for a subject created on commit. */
  subjectId: string | null;
  subjectName: string;
}

export interface ScheduleImportPlan {
  lessons: PlannedLesson[];
  /** Rombel whose lessons the file replaces. */
  classIds: string[];
  newSubjects: string[];
  errors: { row: number; message: string }[];
}

const DAYS: Record<string, number> = { SENIN: 1, SELASA: 2, RABU: 3, KAMIS: 4, JUMAT: 5, "JUM'AT": 5, SABTU: 6, MINGGU: 7 };

export function parseDay(value: string): number | null {
  const text = value.trim().toUpperCase();
  if (/^[1-7]$/.test(text)) return Number(text);
  return DAYS[text] ?? null;
}

/**
 * Turns template rows into lessons for the rombel in the file, replacing their current lessons.
 * Every problem is reported per row; nothing may be applied while errors remain.
 */
export function planScheduleImport(rows: ScheduleRow[], ctx: ScheduleImportContext): ScheduleImportPlan {
  const classes = new Map(ctx.classes.map((c) => [normalizeName(c.name), c]));
  const subjects = new Map(ctx.subjects.map((s) => [normalizeName(s.name), s]));
  const teachers = new Map<string, { id: string; name: string }[]>();
  for (const t of ctx.teachers) teachers.set(normalizeName(t.name), [...(teachers.get(normalizeName(t.name)) ?? []), t]);

  const errors: ScheduleImportPlan['errors'] = [];
  const lessons: PlannedLesson[] = [];
  const newSubjects = new Map<string, string>();

  for (const r of rows) {
    const problems: string[] = [];
    const cls = classes.get(normalizeName(r.className));
    if (!cls) problems.push(`Rombel "${r.className}" tidak ada di tahun ajaran aktif.`);
    const day = parseDay(r.day);
    if (day === null) problems.push(`Hari "${r.day}" tidak dikenali.`);
    const period = /^\d{1,2}$/.test(r.period.trim()) ? Number(r.period) : null;
    if (period === null) problems.push(`Jam ke "${r.period}" harus angka.`);
    if (day !== null && period !== null && !ctx.periods.has(`${day}:${period}`)) problems.push(`Jam ke-${period} belum diatur untuk hari itu.`);
    if (!r.subject.trim()) problems.push('Mapel kosong.');
    let teacherId: string | null = null;
    if (r.teacher.trim()) {
      const hits = teachers.get(normalizeName(r.teacher)) ?? [];
      if (hits.length === 0) problems.push(`Guru "${r.teacher}" bukan staf aktif sekolah.`);
      else if (hits.length > 1) problems.push(`Ada lebih dari satu staf bernama "${r.teacher}".`);
      else teacherId = hits[0]?.id ?? null;
    }
    if (problems.length > 0 || !cls || day === null || period === null) {
      errors.push(...problems.map((message) => ({ row: r.row, message })));
      continue;
    }
    const subject = subjects.get(normalizeName(r.subject));
    if (!subject) newSubjects.set(normalizeName(r.subject), r.subject.trim());
    lessons.push({
      id: `row-${r.row}`,
      row: r.row,
      ownerType: 'class',
      ownerId: cls.id,
      ownerName: cls.name,
      day,
      period,
      teacherId,
      subjectId: subject?.id ?? null,
      subjectName: subject?.name ?? r.subject.trim(),
    });
  }

  const classIds = [...new Set(lessons.map((l) => l.ownerId))];
  const replaced = new Set(classIds);
  const kept = ctx.kept.filter((s) => !(s.ownerType === 'class' && replaced.has(s.ownerId)));
  const planned = new Map(lessons.map((l) => [l.id, l]));
  const keptNames = new Map(kept.map((k) => [k.id, k.ownerName]));
  for (const c of findScheduleConflicts([...lessons, ...kept], ctx.studentsOf)) {
    // Report on the later file row; kept slots only ever come after the file rows.
    const mine = planned.get(c.b.id) ?? planned.get(c.a.id);
    if (!mine) continue;
    const other = mine.id === c.b.id ? c.a : c.b;
    const otherRow = planned.get(other.id);
    const where = otherRow ? `${otherRow.ownerName} (baris ${otherRow.row})` : (keptNames.get(other.id) ?? '');
    const message =
      c.kind === 'owner'
        ? `${mine.ownerName} sudah punya pelajaran di jam ini (baris ${otherRow?.row ?? '?'}).`
        : c.kind === 'teacher'
          ? `Guru yang sama juga mengajar ${where} di jam ini.`
          : `${c.studentIds.length} siswa juga punya pelajaran ${where} di jam ini.`;
    errors.push({ row: mine.row, message });
  }

  errors.sort((a, b) => a.row - b.row);
  return { lessons, classIds, newSubjects: [...newSubjects.values()], errors };
}

/** Stable summary of what a commit would write, to detect a preview gone stale. */
export function scheduleSignature(plan: ScheduleImportPlan): unknown {
  return {
    lessons: plan.lessons.map((l) => [l.ownerId, l.day, l.period, l.subjectId ?? l.subjectName, l.teacherId]).sort(),
    newSubjects: [...plan.newSubjects].sort(),
    errors: plan.errors.map((e) => [e.row, e.message]),
  };
}
