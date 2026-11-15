import type { SchoolMember, UpdateMembershipStatusRequest } from '@absah/contracts';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { canManageMemberships } from '../domain/policies';
import { findSchoolMember, lockMembership, setMembershipStatus } from '../infrastructure/membership-repo';

/**
 * Activates or suspends a membership in the active school. Setting the status it already has
 * is a no-op without an audit entry, so blind retries cannot double-apply.
 */
export async function updateMembershipStatus(
  actor: Actor,
  auditCtx: AuditContext,
  membershipId: string,
  input: UpdateMembershipStatusRequest,
): Promise<SchoolMember> {
  authorize(actor, canManageMemberships);

  return withTenant({ schoolId: actor.schoolId, userId: actor.userId }, async (tx) => {
    const current = await lockMembership(tx, membershipId);
    if (!current) throw new NotFoundError('Keanggotaan tidak ditemukan.');
    if (current.userId === actor.userId) throw new ForbiddenError('Anda tidak dapat mengubah keanggotaan Anda sendiri.');
    if (current.status === 'invited') throw new ConflictError('Undangan belum diterima.');

    if (current.status !== input.status) {
      await setMembershipStatus(tx, membershipId, input.status);
      await audit(tx, auditCtx, 'membership.status_changed', { type: 'membership', id: membershipId }, {
        before: { status: current.status },
        after: { status: input.status },
      });
    }

    const member = await findSchoolMember(tx, membershipId);
    if (!member) throw new NotFoundError('Keanggotaan tidak ditemukan.');
    return member;
  });
}
