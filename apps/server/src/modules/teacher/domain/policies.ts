import { TEACHER_CHECKIN_ROLES, TEACHER_LEAVE_DECIDERS } from '@absah/contracts';
import { anyRole } from '../../../shared/policy';

/** GRU-01: staff who teach check in and out themselves. */
export const canCheckInAsTeacher = anyRole(...TEACHER_CHECKIN_ROLES);

/** GRU-02: the same staff ask for izin; the wakasek decides, with kepsek and admin above (a wakasek's own izin needs one of them). */
export const canRequestTeacherLeave = canCheckInAsTeacher;
export const canDecideTeacherLeave = anyRole(...TEACHER_LEAVE_DECIDERS);
/** Reads every teacher's izin; the others read their own. */
export const canSeeAllTeacherLeaves = canDecideTeacherLeave;
