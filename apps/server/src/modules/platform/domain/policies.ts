import { anyRole } from '../../../shared/policy';

/** Who may see the member list of a school (PLT-03). */
export const canViewSchoolMembers = anyRole('admin', 'operator', 'kepsek', 'wakasek');

/** Activate or suspend memberships. Admin only; operators manage data, not people's access. */
export const canManageMemberships = anyRole('admin');

/** Invite staff into the school (PLT-12). */
export const canInviteMembers = anyRole('admin');
