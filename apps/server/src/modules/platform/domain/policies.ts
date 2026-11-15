import { anyRole } from '../../../shared/policy';

/** Who may see the member list of a school (PLT-03). */
export const canViewSchoolMembers = anyRole('admin', 'operator', 'kepsek', 'wakasek');
