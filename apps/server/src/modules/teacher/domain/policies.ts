import { SUBSTITUTION_ASSIGNERS, TEACHER_REPORT_READERS, SUBSTITUTION_VIEWERS, TEACHER_CHECKIN_ROLES, TEACHER_LEAVE_DECIDERS } from '@absah/contracts';
import { anyRole } from '../../../shared/policy';

/** GRU-01: staff who teach check in and out themselves. */
export const canCheckInAsTeacher = anyRole(...TEACHER_CHECKIN_ROLES);

/** GRU-02: the same staff ask for izin; the wakasek decides, with kepsek and admin above (a wakasek's own izin needs one of them). */
export const canRequestTeacherLeave = canCheckInAsTeacher;
export const canDecideTeacherLeave = anyRole(...TEACHER_LEAVE_DECIDERS);
/** Reads every teacher's izin; the others read their own. */
export const canSeeAllTeacherLeaves = canDecideTeacherLeave;

/** GRU-03: the wakasek, piket (and kepsek, admin to read) see which sessions lack a teacher; the wakasek, piket and admin assign. */
export const canSeeSubstitutions = anyRole(...SUBSTITUTION_VIEWERS);
export const canAssignSubstitute = anyRole(...SUBSTITUTION_ASSIGNERS);

/** GRU-04: the monthly report is for the kepsek (and wakasek, admin). */
export const canReadTeacherReport = anyRole(...TEACHER_REPORT_READERS);
