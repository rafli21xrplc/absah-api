import { anyRole, type Actor } from '../../../shared/policy';

/** Sees every session of the school (Hari ini scope=all). */
export const canSeeAllSessions = anyRole('admin', 'operator', 'kepsek', 'wakasek', 'piket');
/** May fill any session: managers, and piket covering an absent teacher. */
const canFillAny = anyRole('admin', 'operator', 'wakasek', 'piket');

export interface SessionOwnership {
  teacherId: string | null;
  mode: string;
  homeroomTeacherId: string | null;
  /** Pembina of the activity, for mode activity (KEG-01). */
  coachIds: readonly string[];
}

/**
 * The session's teacher, the wali kelas for a daily session, a coach for an activity session, or a
 * manager. Nobody fills a PKL session: its status comes from check-in decisions (PKL-02).
 */
export function mayFillSession(actor: Actor, session: SessionOwnership): boolean {
  if (session.mode === 'pkl') return false;
  if (session.teacherId === actor.userId) return true;
  if (session.mode === 'daily' && session.homeroomTeacherId === actor.userId) return true;
  if (session.mode === 'activity' && session.coachIds.includes(actor.userId)) return true;
  return canFillAny.allows(actor);
}

export function mayViewSession(actor: Actor, session: SessionOwnership): boolean {
  return mayFillSession(actor, session) || canSeeAllSessions.allows(actor);
}

/** Decides correction requests on locked sessions (PRS-05). */
export const canDecideCorrections = anyRole('wakasek', 'kepsek');

/** Reads every teacher's jurnal mengajar (PRS-09); a guru reads only their own. */
export const canReadAllJournals = anyRole('admin', 'kepsek', 'wakasek');
