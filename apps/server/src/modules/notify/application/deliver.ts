import { defineConsumer } from '../../../shared/outbox';
import { SendError, type MessageSender } from '../../../shared/messaging';
import { maskPhone, orderedParams, renderTemplate } from '../domain/messages';
import { forSend, markFailed, markSent } from '../infrastructure/notify-repo';

/** Three attempts in all (pg-boss backoff between them), then the notification is failed. */
export const SEND_RETRIES = 2;

/**
 * Sends one notification. Runs in the consumer's transaction with the row locked, so a
 * redelivered event finds it already sent. Retryable errors throw (pg-boss retries with backoff)
 * until the last attempt; final errors and the last attempt record failed and return.
 * If the process dies after the provider accepted but before commit, the retry sends again: at
 * least once, never silently lost.
 */
export function deliverConsumer(sender: MessageSender) {
  return defineConsumer({
    name: 'notify_send',
    event: 'notification.queued',
    retryLimit: SEND_RETRIES,
    async handle(tx, event, delivery) {
      const row = await forSend(tx, event.payload.notificationId);
      if (!row || row.status !== 'queued') return;
      const attempts = delivery.attempt + 1;
      const fail = (error: string) => markFailed(tx, row.id, error, attempts, new Date());
      const template = row.template;
      if (!template) return fail('no_template');
      if (sender.requiresApprovedTemplates && template.approval !== 'approved') return fail('template_not_approved');

      const to = row.toPhone.reveal();
      const params = JSON.parse(row.params.reveal()) as Record<string, string>;
      try {
        const sent = await sender.sendTemplate({
          to,
          template: { name: template.providerName, language: row.language },
          params: orderedParams(template.params, params),
          text: renderTemplate(template.body, params),
        });
        await markSent(tx, row.id, sent.providerMessageId, attempts, new Date());
      } catch (err) {
        const code = err instanceof SendError ? err.code : 'internal';
        if (err instanceof SendError && err.retryable && !delivery.lastAttempt) {
          throw new Error(`notify: send to ${maskPhone(to)} failed (${code}), will retry`, { cause: err });
        }
        await fail(code);
      }
    },
  });
}
