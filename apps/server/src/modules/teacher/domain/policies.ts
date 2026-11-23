import { TEACHER_CHECKIN_ROLES } from '@absah/contracts';
import { anyRole } from '../../../shared/policy';

/** GRU-01: staff who teach check in and out themselves. */
export const canCheckInAsTeacher = anyRole(...TEACHER_CHECKIN_ROLES);
