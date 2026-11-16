import { anyRole, type Actor } from '../../../shared/policy';

/** Decide any izin of the school, as a fallback for the wali kelas. */
export const canDecideAnyLeave = anyRole('wakasek', 'kepsek');

export interface LeaveStudent {
  homeroomTeacherId: string | null;
}

/** The wali kelas of the student's rombel, or wakasek/kepsek (IZN-02). */
export const mayDecideLeave = (actor: Actor, student: LeaveStudent) => student.homeroomTeacherId === actor.userId || canDecideAnyLeave.allows(actor);
