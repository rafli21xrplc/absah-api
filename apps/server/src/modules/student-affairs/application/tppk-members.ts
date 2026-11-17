import { TPPK_MIN_MEMBERS, type SetTppkMembersRequest, type TppkMemberList } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { audit, type AuditContext } from '../../../shared/audit';
import { withTenant } from '../../../shared/db';
import { ForbiddenError, ValidationError } from '../../../shared/errors';
import { emit } from '../../../shared/outbox';
import type { Actor } from '../../../shared/policy';
import { canAppointTppk, canSeeTppkTeam } from '../domain/policies';
import { activeStaff, addMembers, listMembers, removeMembers } from '../infrastructure/tppk-members-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });

async function team(tx: Tx): Promise<TppkMemberList> {
  const items = (await listMembers(tx)).map((r) => ({ userId: r.userId, name: r.name, appointedAt: r.appointedAt.toISOString(), canBeNotified: r.canBeNotified }));
  return { items, minimum: TPPK_MIN_MEMBERS, belowMinimum: items.length < TPPK_MIN_MEMBERS };
}

export function getTeam(actor: Actor): Promise<TppkMemberList> {
  if (!canSeeTppkTeam.allows(actor)) throw new ForbiddenError();
  return withTenant(scope(actor), team);
}

/**
 * Replaces the team. Members must be active staff of the school. Fewer than three is allowed
 * (a school may be forming its team) and reported as belowMinimum. The change is audited and
 * tppk.members_changed tells the whole team, so an admin cannot quietly appoint themself.
 */
export function setTeam(actor: Actor, auditCtx: AuditContext, input: SetTppkMembersRequest): Promise<TppkMemberList> {
  if (!canAppointTppk.allows(actor)) throw new ForbiddenError('Anggota TPPK ditunjuk oleh admin sekolah.');
  return withTenant(scope(actor), async (tx) => {
    const staff = await activeStaff(tx, input.userIds);
    const unknown = input.userIds.filter((id) => !staff.has(id));
    if (unknown.length > 0) throw new ValidationError({ userIds: unknown }, 'Anggota TPPK harus staf aktif sekolah ini.');

    const current = new Set((await listMembers(tx)).map((r) => r.userId));
    const wanted = new Set(input.userIds);
    const added = input.userIds.filter((id) => !current.has(id));
    const removed = [...current].filter((id) => !wanted.has(id));
    if (added.length === 0 && removed.length === 0) return team(tx);

    await removeMembers(tx, removed);
    await addMembers(tx, actor.schoolId, added, actor.userId);
    await audit(tx, auditCtx, 'tppk.members_changed', { type: 'tppk_team', id: actor.schoolId }, { after: { added, removed } });
    await emit(tx, 'tppk.members_changed', { added, removed });
    return team(tx);
  });
}
