import type { SubstituteCandidate } from '@absah/contracts';

export type Unavailable = 'not_a_teacher' | 'is_absent_teacher' | 'on_leave' | 'busy';

/**
 * Why a person cannot take a session over, or null when they can. The absent teacher comes first (they are on
 * leave too, but "pick someone else" is the clearer message), then izin, then a clash with their own lesson.
 */
export function unavailableReason(input: { userId: string; absentTeacherId: string; pool: ReadonlySet<string>; onLeave: ReadonlySet<string>; busy: ReadonlySet<string> }): Unavailable | null {
  if (input.userId === input.absentTeacherId) return 'is_absent_teacher';
  if (!input.pool.has(input.userId)) return 'not_a_teacher';
  if (input.onLeave.has(input.userId)) return 'on_leave';
  if (input.busy.has(input.userId)) return 'busy';
  return null;
}

/**
 * The order a wakasek wants: someone already at school, then the same subject, then whoever has stood in least this
 * month, then by name so the list is stable.
 */
export function rankCandidates(list: readonly SubstituteCandidate[]): SubstituteCandidate[] {
  return [...list].sort(
    (a, b) =>
      Number(b.checkedIn) - Number(a.checkedIn) || Number(b.sameSubject) - Number(a.sameSubject) || a.substitutionsThisMonth - b.substitutionsThisMonth || a.name.localeCompare(b.name, 'id') || a.userId.localeCompare(b.userId),
  );
}

/** Sessions a substitute can take: lessons and daily sessions, never an activity or PKL session. */
export const isSubstitutableMode = (mode: string): boolean => mode === 'per_period' || mode === 'daily';
