import { maskPhone, type MutableTemplateCode, type NotificationPreferences, type UpdateNotificationPreferencesRequest } from '@absah/contracts';
import { audit, type AuditContext } from '../../../shared/audit';
import { withTenant } from '../../../shared/db';
import { ForbiddenError, NotFoundError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { canSetPreferences } from '../domain/policies';
import { guardianRowsOfUser, savePreference } from '../infrastructure/notify-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });

function parentOnly(actor: Actor) {
  if (!canSetPreferences.allows(actor)) throw new ForbiddenError('Pengaturan ini untuk orang tua.');
}

type Row = Awaited<ReturnType<typeof guardianRowsOfUser>>[number];

/** No stored row means the defaults: everything is sent, outside the quiet hours. */
function present(first: Row): NotificationPreferences {
  return {
    phone: first.phone ? maskPhone(first.phone.reveal()) : null,
    // The API only ever stores MUTABLE_TEMPLATE_CODES; the contract check on the way out confirms it.
    mutedTypes: (first.mutedTypes ?? []) as MutableTemplateCode[],
    noLateMessages: first.noLateMessages ?? false,
  };
}

/** GET /portal/notification-preferences: the parent's own choices at this school. */
export function getPreferences(actor: Actor): Promise<NotificationPreferences> {
  parentOnly(actor);
  return withTenant(scope(actor), async (tx) => {
    const [first] = await guardianRowsOfUser(tx, actor.userId);
    if (!first) throw new NotFoundError('Data orang tua tidak ditemukan.');
    return present(first);
  });
}

/**
 * PUT /portal/notification-preferences: replaces the choices on every guardian row the account owns
 * at this school (one person, one set of choices). Only switchable types are accepted by the contract.
 */
export function updatePreferences(actor: Actor, ctx: AuditContext, input: UpdateNotificationPreferencesRequest): Promise<NotificationPreferences> {
  parentOnly(actor);
  return withTenant(scope(actor), async (tx) => {
    const rows = await guardianRowsOfUser(tx, actor.userId);
    const [first] = rows;
    if (!first) throw new NotFoundError('Data orang tua tidak ditemukan.');
    for (const r of rows) await savePreference(tx, { schoolId: actor.schoolId, guardianId: r.guardianId, mutedTypes: input.mutedTypes, noLateMessages: input.noLateMessages });
    await audit(tx, ctx, 'notification.preferences_updated', { type: 'notification_preferences', id: first.guardianId }, {
      before: { mutedTypes: first.mutedTypes ?? [], noLateMessages: first.noLateMessages ?? false },
      after: { mutedTypes: input.mutedTypes, noLateMessages: input.noLateMessages },
    });
    return present({ ...first, mutedTypes: input.mutedTypes, noLateMessages: input.noLateMessages });
  });
}
