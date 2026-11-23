import { PUSH_MAX_PER_USER, type PushStatus, type PushSubscribeRequest, type PushUnsubscribeRequest } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { audit, type AuditContext } from '../../../shared/audit';
import { hashValue } from '../../../shared/crypto';
import { withTenant } from '../../../shared/db';
import { ForbiddenError, NotFoundError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { PushError, type PushMessage, type PushSender } from '../../../shared/push';
import { canUsePush } from '../domain/policies';
import { deletePushByEndpoint, deletePushSubscriptions, pushSubscriptionsOf, savePushSubscription } from '../infrastructure/notify-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const endpointHash = (endpoint: string) => hashValue(`push-endpoint:${endpoint}`);

function staffOnly(actor: Actor, enabled: boolean) {
  if (!enabled) throw new NotFoundError('Notifikasi push belum aktif di server ini.');
  if (!canUsePush.allows(actor)) throw new ForbiddenError('Notifikasi push untuk staf sekolah.');
}

/**
 * PUT /push/subscriptions: this browser receives push for the caller at the active school. The same
 * endpoint again only refreshes its keys; beyond PUSH_MAX_PER_USER the oldest devices are dropped.
 */
export function subscribePush(actor: Actor, ctx: AuditContext, enabled: boolean, input: PushSubscribeRequest): Promise<PushStatus> {
  staffOnly(actor, enabled);
  return withTenant(scope(actor), async (tx) => {
    await savePushSubscription(tx, { schoolId: actor.schoolId, userId: actor.userId, endpointHash: endpointHash(input.endpoint), endpoint: input.endpoint, p256dh: input.keys.p256dh, auth: input.keys.auth });
    const all = await pushSubscriptionsOf(tx, actor.userId);
    await deletePushSubscriptions(tx, all.slice(PUSH_MAX_PER_USER).map((s) => s.id));
    const devices = Math.min(all.length, PUSH_MAX_PER_USER);
    // Never the endpoint: it is a credential.
    await audit(tx, ctx, 'push.subscribed', { type: 'push_subscription', id: null }, { after: { devices } });
    return { devices };
  });
}

/** POST /push/subscriptions/remove: this browser stops receiving push. Unknown endpoints are a no-op. */
export function unsubscribePush(actor: Actor, ctx: AuditContext, enabled: boolean, input: PushUnsubscribeRequest): Promise<PushStatus> {
  staffOnly(actor, enabled);
  return withTenant(scope(actor), async (tx) => {
    const before = (await pushSubscriptionsOf(tx, actor.userId)).length;
    await deletePushByEndpoint(tx, actor.userId, endpointHash(input.endpoint));
    const devices = (await pushSubscriptionsOf(tx, actor.userId)).length;
    if (devices !== before) await audit(tx, ctx, 'push.unsubscribed', { type: 'push_subscription', id: null }, { after: { devices } });
    return { devices };
  });
}

/**
 * Sends one message to every device a member enabled at the current school (inside the consumer's
 * tenant transaction). Devices the push service reports as gone are dropped. Returns how many accepted it.
 * Push is best effort: one accepted device is enough, but if none accepted and one failure is
 * retryable the error is thrown so the outbox retries the event (devices that did get it show the
 * message once more at worst: `tag` collapses it).
 */
export async function pushToUser(tx: Tx, sender: PushSender, userId: string, message: PushMessage): Promise<number> {
  const subs = await pushSubscriptionsOf(tx, userId);
  const gone: string[] = [];
  let accepted = 0;
  let retryable: PushError | undefined;
  for (const sub of subs) {
    try {
      await sender.send({ endpoint: sub.endpoint.reveal(), p256dh: sub.p256dh.reveal(), auth: sub.auth.reveal() }, message);
      accepted += 1;
    } catch (err) {
      if (!(err instanceof PushError)) throw err;
      if (err.kind === 'gone') gone.push(sub.id);
      else if (err.kind === 'retryable') retryable = err;
    }
  }
  await deletePushSubscriptions(tx, gone);
  if (accepted === 0 && retryable) throw retryable;
  return accepted;
}
