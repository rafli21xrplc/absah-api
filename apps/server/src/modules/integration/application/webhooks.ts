import { randomBytes } from 'node:crypto';
import type { CreatedWebhook, CreateWebhookRequest, UpdateWebhookRequest, Webhook, WebhookDelivery, WebhookDeliveryList, WebhookEventType, WebhookList, WebhookTestQueued } from '@absah/contracts';
import { WEBHOOK_DELIVERIES_SHOWN, WEBHOOK_MAX_ENDPOINTS, WEBHOOK_SECRET_PREFIX, WEBHOOK_TEST_EVENT } from '@absah/contracts';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import { emit } from '../../../shared/outbox';
import type { Actor } from '../../../shared/policy';
import { canManageIntegrations } from '../domain/policies';
import { webhookUrlPreview, webhookUrlProblem, type UrlProblem } from '../domain/webhook-url';
import { deleteWebhook, findWebhook, insertDelivery, insertWebhook, listWebhooks, pendingTest, recentDeliveries, updateWebhook, webhookCount, type DeliveryRow, type WebhookRow } from '../infrastructure/webhook-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });

const PROBLEMS: Record<UrlProblem, string> = {
  not_https: 'Alamat harus diawali https://.',
  credentials: 'Alamat tidak boleh memuat nama pengguna atau kata sandi.',
  port: 'Gunakan port https standar (443).',
  private_host: 'Alamat ini tidak bisa dijangkau dari internet. Gunakan alamat publik milik sistem Anda.',
};

function checkUrl(url: string): void {
  const problem = webhookUrlProblem(url);
  if (problem) throw new ValidationError({ field: 'url', reason: problem }, PROBLEMS[problem]);
}

export const viewWebhook = (r: WebhookRow): Webhook => ({
  id: r.id,
  urlPreview: webhookUrlPreview(r.url.reveal()),
  events: r.events as WebhookEventType[],
  active: r.active,
  disabledReason: r.disabledReason === 'too_many_failures' ? 'too_many_failures' : null,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});

export function listWebhookEndpoints(actor: Actor): Promise<WebhookList> {
  authorize(actor, canManageIntegrations);
  return withTenant(scope(actor), async (tx) => ({ items: (await listWebhooks(tx)).map(viewWebhook) }));
}

/** Registers an endpoint and returns its signing secret once. At most WEBHOOK_MAX_ENDPOINTS per school (409 too_many). */
export function createWebhookEndpoint(actor: Actor, auditCtx: AuditContext, input: CreateWebhookRequest): Promise<CreatedWebhook> {
  authorize(actor, canManageIntegrations);
  checkUrl(input.url);
  return withTenant(scope(actor), async (tx) => {
    if ((await webhookCount(tx)) >= WEBHOOK_MAX_ENDPOINTS) throw new ConflictError('Jumlah alamat webhook sudah mencapai batas. Hapus yang tidak dipakai dulu.', { reason: 'too_many' });
    const secret = `${WEBHOOK_SECRET_PREFIX}${randomBytes(32).toString('base64url')}`;
    const row = await insertWebhook(tx, { id: uuidv7(), schoolId: actor.schoolId, url: input.url, secret, events: [...new Set(input.events)], createdBy: actor.userId });
    // The audit log holds the host and the events; never the path (may carry a token) and never the secret.
    await audit(tx, auditCtx, 'integration.webhook_created', { type: 'webhook', id: row.id }, { after: { host: webhookUrlPreview(input.url), events: row.events } });
    return { ...viewWebhook(row), secret };
  });
}

export function updateWebhookEndpoint(actor: Actor, auditCtx: AuditContext, id: string, input: UpdateWebhookRequest): Promise<Webhook> {
  authorize(actor, canManageIntegrations);
  if (input.url !== undefined) checkUrl(input.url);
  return withTenant(scope(actor), async (tx) => {
    const before = await findWebhook(tx, id);
    if (!before) throw new NotFoundError('Alamat webhook tidak ditemukan.');
    const row = await updateWebhook(tx, id, { url: input.url, events: input.events === undefined ? undefined : [...new Set(input.events)], active: input.active });
    if (!row) throw new NotFoundError('Alamat webhook tidak ditemukan.');
    await audit(
      tx,
      auditCtx,
      'integration.webhook_updated',
      { type: 'webhook', id },
      {
        before: { host: webhookUrlPreview(before.url.reveal()), events: before.events, active: before.active },
        after: { host: webhookUrlPreview(row.url.reveal()), events: row.events, active: row.active },
      },
    );
    return viewWebhook(row);
  });
}

/** Deleting twice is a 404 the second time: the endpoint is gone. */
export function deleteWebhookEndpoint(actor: Actor, auditCtx: AuditContext, id: string): Promise<void> {
  authorize(actor, canManageIntegrations);
  return withTenant(scope(actor), async (tx) => {
    if (!(await deleteWebhook(tx, id))) throw new NotFoundError('Alamat webhook tidak ditemukan.');
    await audit(tx, auditCtx, 'integration.webhook_deleted', { type: 'webhook', id });
  });
}

/** A ping still waiting for this long no longer blocks the next one. */
export const WEBHOOK_TEST_WAIT_MINUTES = 10;

const viewDelivery = (r: DeliveryRow): WebhookDelivery => ({
  id: r.id,
  eventType: r.eventType,
  status: r.status as WebhookDelivery['status'],
  attempts: r.attempts,
  lastStatus: r.lastStatus,
  lastError: r.lastError,
  createdAt: r.createdAt.toISOString(),
  finishedAt: r.finishedAt?.toISOString() ?? null,
});

/** The last calls to one address, newest first; the body of a call is never part of the answer. */
export function listWebhookDeliveries(actor: Actor, id: string): Promise<WebhookDeliveryList> {
  authorize(actor, canManageIntegrations);
  return withTenant(scope(actor), async (tx) => {
    if (!(await findWebhook(tx, id))) throw new NotFoundError('Alamat webhook tidak ditemukan.');
    return { items: (await recentDeliveries(tx, id, WEBHOOK_DELIVERIES_SHOWN)).map(viewDelivery) };
  });
}

/**
 * Stores one ping and asks the worker to send it (rule 3: nothing leaves from here). The same signed call as a real event,
 * with empty data. A switched-off address is 409 inactive; one ping at a time per address (409 already_pending).
 */
export function testWebhookEndpoint(actor: Actor, auditCtx: AuditContext, id: string): Promise<WebhookTestQueued> {
  authorize(actor, canManageIntegrations);
  return withTenant(scope(actor), async (tx) => {
    const endpoint = await findWebhook(tx, id);
    if (!endpoint) throw new NotFoundError('Alamat webhook tidak ditemukan.');
    if (!endpoint.active) throw new ConflictError('Alamat ini sedang dimatikan. Nyalakan dulu sebelum mengirim tes.', { reason: 'inactive' });
    if (await pendingTest(tx, id, WEBHOOK_TEST_EVENT, WEBHOOK_TEST_WAIT_MINUTES)) throw new ConflictError('Tes sebelumnya masih menunggu. Tunggu hasilnya dulu.', { reason: 'already_pending' });
    const deliveryId = await insertDelivery(tx, { id: uuidv7(), schoolId: actor.schoolId, endpointId: id, eventId: uuidv7(), eventType: WEBHOOK_TEST_EVENT, payload: {} });
    if (!deliveryId) throw new Error('webhook test not stored');
    await emit(tx, 'webhook.delivery_requested', { deliveryId });
    await audit(tx, auditCtx, 'integration.webhook_tested', { type: 'webhook', id }, { after: { host: webhookUrlPreview(endpoint.url.reveal()) } });
    return { deliveryId };
  });
}
