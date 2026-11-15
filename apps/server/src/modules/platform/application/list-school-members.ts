import type { SchoolMembersResponse } from '@absah/contracts';
import { authorize } from '../../../shared/authorize';
import type { Actor } from '../../../shared/policy';
import { canViewSchoolMembers } from '../domain/policies';
import { listSchoolMembers as listFromDb } from '../infrastructure/membership-repo';

export async function listSchoolMembers(actor: Actor): Promise<SchoolMembersResponse> {
  authorize(actor, canViewSchoolMembers);
  const items = await listFromDb({ schoolId: actor.schoolId, userId: actor.userId });
  return { items };
}
