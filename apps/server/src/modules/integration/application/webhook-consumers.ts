import { WEBHOOK_TEST_EVENT, type WebhookEventType } from '@absah/contracts';
import { uuidv7 } from 'uuidv7';
import { audit } from '../../../shared/audit';
import { readCapabilityRows, resolveFromRows } from '../../../shared/capability';
import { defineConsumer, emit, type Consumer } from '../../../shared/outbox';
import { schoolDate } from '../../../shared/school-date';
import { schoolOfKey } from '../infrastructure/api-key-repo';
import { shouldDisable, WEBHOOK_AUTO_DISABLE_AFTER } from '../domain/webhook-health';
import { deliveryForSend, disableForFailures, endpointsFor, finishDelivery, insertDelivery, recentOutcomes } from '../infrastructure/webhook-repo';
import { WebhookSendError, type WebhookSender } from '../infrastructure/webhook-sender';

/** Total attempts = this + 1, with pg-boss's backoff between them: a receiver that is down for a few minutes still gets it. */
export const WEBHOOK_RETRIES = 5;

const FANOUT: { event: WebhookEventType; name: string }[] = [
  { event: 'attendance.absent_marked', name: 'integration_webhook_absent_marked' },
  { event: 'attendance.session_locked', name: 'integration_webhook_session_locked' },
  { event: 'leave.approved', name: 'integration_webhook_leave_approved' },
  { event: 'leave.cancelled', name: 'integration_webhook_leave_cancelled' },
];

/** 408, 425, 429 and 5xx are the receiver's trouble of the moment; anything else that is not 2xx is an answer to stop on. */
export const retryableStatus = (status: number): boolean => status === 408 || status === 425 || status === 429 || status >= 500;

/**
 * Fan-out: one stored delivery per active endpoint that wants this event, then one webhook.delivery_requested each. Nothing
 * leaves the process here (rule 3); a school without platform.openApi (or under a kill switch) sends nothing.
 */
function fanOut(consumer: { event: WebhookEventType; name: string }): Consumer {
  return defineConsumer({
    name: consumer.name,
    event: consumer.event,
    async handle(tx, event) {
      const school = await schoolOfKey(tx, event.schoolId);
      if (!school) return;
      if (resolveFromRows(school, await readCapabilityRows(tx), schoolDate(school.timezone))['platform.openApi'] !== true) return;
      for (const endpoint of await endpointsFor(tx, event.type)) {
        const deliveryId = await insertDelivery(tx, { id: uuidv7(), schoolId: event.schoolId, endpointId: endpoint.id, eventId: event.id, eventType: event.type, payload: event.payload });
        if (deliveryId) await emit(tx, 'webhook.delivery_requested', { deliveryId });
      }
    },
  });
}

/** What the receiver gets: ids and counts only, never a name. `id` is the event, the same for every endpoint. */
export function webhookBody(row: { eventId: string; eventType: string; schoolId: string; createdAt: Date; payload: unknown }): string {
  return JSON.stringify({ id: row.eventId, type: row.eventType, schoolId: row.schoolId, createdAt: row.createdAt.toISOString(), data: row.payload });
}

/**
 * Posts one stored delivery. Retryable failures throw (the writes roll back, pg-boss retries) until the last attempt; then, and
 * for answers that are final, the outcome is recorded and the call stays failed. A crash after the receiver answered but before
 * the commit posts again: at least once, so receivers drop repeats by X-Absah-Delivery.
 */
function sendConsumer(sender: WebhookSender): Consumer {
  return defineConsumer({
    name: 'integration_webhook_send',
    event: 'webhook.delivery_requested',
    retryLimit: WEBHOOK_RETRIES,
    async handle(tx, event, delivery) {
      const found = await deliveryForSend(tx, event.payload.deliveryId);
      if (!found || found.delivery.status !== 'pending') return;
      const { delivery: row, endpoint } = found;
      const attempts = delivery.attempt + 1;
      const fail = async (lastError: string, lastStatus: number | null = null) => {
        await finishDelivery(tx, row.id, { status: 'failed', attempts, lastStatus, lastError });
        // A ping is the admin's own try and a call refused because the address is off says nothing about the receiver.
        if (row.eventType === WEBHOOK_TEST_EVENT || lastError === 'endpoint_off') return;
        if (shouldDisable(await recentOutcomes(tx, row.endpointId, WEBHOOK_AUTO_DISABLE_AFTER)) && (await disableForFailures(tx, row.endpointId))) {
          await audit(tx, { schoolId: row.schoolId, actorUserId: null, requestId: null, ip: null }, 'integration.webhook_auto_disabled', { type: 'webhook', id: row.endpointId }, { after: { active: false, reason: 'too_many_failures', failures: WEBHOOK_AUTO_DISABLE_AFTER } });
        }
      };
      if (!endpoint?.active) return fail('endpoint_off');

      try {
        const { status } = await sender.post({
          url: endpoint.url.reveal(),
          secret: endpoint.secret.reveal(),
          deliveryId: row.id,
          eventType: row.eventType,
          body: webhookBody(row),
          timestamp: Math.floor(Date.now() / 1000),
        });
        if (status >= 200 && status < 300) return finishDelivery(tx, row.id, { status: 'delivered', attempts, lastStatus: status, lastError: null });
        if (retryableStatus(status) && !delivery.lastAttempt) throw new Error(`webhook: receiver answered ${status}, will retry`);
        return fail(`http_${status}`, status);
      } catch (err) {
        if (err instanceof WebhookSendError) {
          if (err.retryable && !delivery.lastAttempt) throw new Error(`webhook: send failed (${err.kind}), will retry`, { cause: err });
          return fail(err.kind === 'blocked' ? 'blocked_address' : err.kind);
        }
        throw err;
      }
    },
  });
}

/** Outbox consumers of the open API's webhooks; the worker registers them with the real sender. */
export function webhookConsumers(sender: WebhookSender): Consumer[] {
  return [...FANOUT.map(fanOut), sendConsumer(sender)];
}
