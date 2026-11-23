import { maskNik, normalizeName, type ImportedStudent } from './student-import';

/** A student already in the school, with the active enrollment of the target academic year. */
export interface ExistingStudent {
  id: string;
  name: string;
  nisn: string | null;
  nikHash: string | null;
  localId: string | null;
  gender: string | null;
  birthPlace: string | null;
  birthDate: string | null;
  /** Active enrollment in the target year, if any. */
  enrollment: { id: string; className: string; missingSince: Date | null } | null;
}

/** An imported row with its NIK hashed by the application (the domain has no keys). */
export interface IncomingStudent extends ImportedStudent {
  nikHash: string | null;
}

export type MatchKey = 'nisn' | 'nik' | 'name_birthdate';

export type ChangedField = 'name' | 'nisn' | 'nik' | 'localId' | 'gender' | 'birthPlace' | 'birthDate' | 'className';

export interface FieldChange {
  field: ChangedField;
  from: string | null;
  to: string | null;
}

export interface MatchedStudent {
  studentId: string;
  matchedBy: MatchKey;
  incoming: IncomingStudent;
  changes: FieldChange[];
}

export interface ImportPlan {
  created: IncomingStudent[];
  changed: MatchedStudent[];
  unchanged: MatchedStudent[];
  /** Active this year but absent from the file: flagged "calon keluar", never deleted. */
  missing: ExistingStudent[];
  rejected: { row: number; message: string }[];
}

const key = (name: string, birthDate: string) => `${normalizeName(name)}|${birthDate}`;

function indexBy<T>(items: T[], pick: (item: T) => string | null): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const k = pick(item);
    if (k === null) continue;
    map.set(k, [...(map.get(k) ?? []), item]);
  }
  return map;
}

/** Fields the file changes. A value missing from the file never erases what the school has. */
function diff(existing: ExistingStudent, incoming: IncomingStudent): FieldChange[] {
  const changes: FieldChange[] = [];
  const compare = (field: ChangedField, from: string | null, to: string | null) => {
    if (to !== null && to !== from) changes.push({ field, from, to });
  };
  compare('name', existing.name, incoming.name);
  compare('nisn', existing.nisn, incoming.nisn);
  if (incoming.nikHash !== null && incoming.nik !== null && incoming.nikHash !== existing.nikHash) {
    changes.push({ field: 'nik', from: existing.nikHash ? 'tersimpan' : null, to: maskNik(incoming.nik) });
  }
  compare('localId', existing.localId, incoming.localId);
  compare('gender', existing.gender, incoming.gender);
  compare('birthPlace', existing.birthPlace, incoming.birthPlace);
  compare('birthDate', existing.birthDate, incoming.birthDate);
  compare('className', existing.enrollment?.className ?? null, incoming.className);
  return changes;
}

/**
 * Matches imported rows to existing students: NISN first, then NIK, then name + birth date.
 * Each existing student matches at most one row; duplicates and ambiguous rows are rejected so
 * staff fix the file instead of Absah guessing. Importing the same file twice changes nothing.
 */
export function planStudentImport(existing: ExistingStudent[], incoming: IncomingStudent[]): ImportPlan {
  const plan: ImportPlan = { created: [], changed: [], unchanged: [], missing: [], rejected: [] };
  const byNisn = indexBy(existing, (s) => s.nisn);
  const byNik = indexBy(existing, (s) => s.nikHash);
  const byNameDate = indexBy(existing, (s) => (s.birthDate ? key(s.name, s.birthDate) : null));
  const taken = new Set<string>();

  const seenNisn = indexBy(incoming, (s) => s.nisn);
  const seenNik = indexBy(incoming, (s) => s.nikHash);

  for (const row of incoming) {
    if (row.nisn !== null && (seenNisn.get(row.nisn)?.length ?? 0) > 1) {
      plan.rejected.push({ row: row.row, message: `NISN ${row.nisn} muncul lebih dari sekali di berkas.` });
      continue;
    }
    if (row.nikHash !== null && (seenNik.get(row.nikHash)?.length ?? 0) > 1) {
      plan.rejected.push({ row: row.row, message: 'NIK yang sama muncul lebih dari sekali di berkas.' });
      continue;
    }

    let match: { student: ExistingStudent; by: MatchKey } | null = null;
    const nisnHit = row.nisn !== null ? byNisn.get(row.nisn)?.[0] : undefined;
    const nikHit = row.nikHash !== null ? byNik.get(row.nikHash)?.[0] : undefined;
    if (nisnHit) match = { student: nisnHit, by: 'nisn' };
    else if (nikHit) match = { student: nikHit, by: 'nik' };
    else if (row.birthDate !== null) {
      const hits = (byNameDate.get(key(row.name, row.birthDate)) ?? []).filter((s) => !taken.has(s.id));
      if (hits.length > 1) {
        plan.rejected.push({ row: row.row, message: 'Ada lebih dari satu siswa dengan nama dan tanggal lahir ini. Lengkapi NISN atau NIK.' });
        continue;
      }
      // A name match must not contradict an identifier the school already has.
      const hit = hits[0];
      if (hit && !(hit.nisn && row.nisn && hit.nisn !== row.nisn)) match = { student: hit, by: 'name_birthdate' };
    }

    if (!match) {
      plan.created.push(row);
      continue;
    }
    if (taken.has(match.student.id)) {
      plan.rejected.push({ row: row.row, message: 'Baris ini cocok dengan siswa yang sama dengan baris lain.' });
      continue;
    }
    // A new NISN or NIK must not belong to a different student.
    const nisnOwner = row.nisn !== null ? byNisn.get(row.nisn)?.[0] : undefined;
    const nikOwner = row.nikHash !== null ? byNik.get(row.nikHash)?.[0] : undefined;
    if ((nisnOwner && nisnOwner.id !== match.student.id) || (nikOwner && nikOwner.id !== match.student.id)) {
      plan.rejected.push({ row: row.row, message: 'NISN dan NIK di baris ini milik dua siswa berbeda di Absah.' });
      continue;
    }

    taken.add(match.student.id);
    const changes = diff(match.student, row);
    const result = { studentId: match.student.id, matchedBy: match.by, incoming: row, changes };
    if (changes.length > 0) plan.changed.push(result);
    else plan.unchanged.push(result);
  }

  plan.missing = existing.filter((s) => s.enrollment !== null && !taken.has(s.id));
  return plan;
}
