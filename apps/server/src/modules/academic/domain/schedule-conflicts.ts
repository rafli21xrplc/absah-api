import type { SlotOwnerType } from '@absah/contracts';

export interface TimedSlot {
  /** Existing slot id, or a temporary id for proposed slots. */
  id: string;
  ownerType: SlotOwnerType;
  ownerId: string;
  day: number;
  period: number;
  teacherId: string | null;
}

export type ScheduleConflict =
  | { kind: 'owner'; a: TimedSlot; b: TimedSlot }
  | { kind: 'teacher'; a: TimedSlot; b: TimedSlot; teacherId: string }
  | { kind: 'student'; a: TimedSlot; b: TimedSlot; studentIds: string[] };

const ownerKey = (s: Pick<TimedSlot, 'ownerType' | 'ownerId'>) => `${s.ownerType}:${s.ownerId}`;

/**
 * Every clash in a set of slots: the same rombel/group twice at one time, a teacher twice at one
 * time, or a student in two slots at one time (through a rombel and a group, or two groups).
 * studentsOf returns the students of an owner (active enrollments of a rombel, members of a group).
 */
export function findScheduleConflicts(
  slots: TimedSlot[],
  studentsOf: (owner: Pick<TimedSlot, 'ownerType' | 'ownerId'>) => ReadonlySet<string>,
): ScheduleConflict[] {
  const byTime = new Map<string, TimedSlot[]>();
  for (const s of slots) {
    const k = `${s.day}:${s.period}`;
    byTime.set(k, [...(byTime.get(k) ?? []), s]);
  }
  const conflicts: ScheduleConflict[] = [];
  for (const group of byTime.values()) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const a = group[i];
        const b = group[j];
        if (!a || !b) continue;
        if (ownerKey(a) === ownerKey(b)) {
          conflicts.push({ kind: 'owner', a, b });
          continue;
        }
        if (a.teacherId && a.teacherId === b.teacherId) conflicts.push({ kind: 'teacher', a, b, teacherId: a.teacherId });
        const sa = studentsOf(a);
        const shared = [...studentsOf(b)].filter((id) => sa.has(id));
        if (shared.length > 0) conflicts.push({ kind: 'student', a, b, studentIds: shared });
      }
    }
  }
  return conflicts;
}

export interface PeriodInput {
  number: number;
  startsAt: string;
  endsAt: string;
}

/** Jam pelajaran of one day: unique numbers, start before end, in order without overlap. */
export function validateDayPeriods(periods: PeriodInput[]): string[] {
  const problems: string[] = [];
  const numbers = new Set<number>();
  for (const p of periods) {
    if (numbers.has(p.number)) problems.push(`Jam ke-${p.number} tercantum dua kali.`);
    numbers.add(p.number);
    if (p.startsAt >= p.endsAt) problems.push(`Jam ke-${p.number}: jam mulai harus sebelum jam selesai.`);
  }
  const sorted = [...periods].sort((x, y) => x.number - y.number);
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    if (prev && cur && cur.startsAt < prev.endsAt) problems.push(`Jam ke-${cur.number} dimulai sebelum jam ke-${prev.number} selesai.`);
  }
  return problems;
}
