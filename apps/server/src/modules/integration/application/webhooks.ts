import { randomBytes } from 'node:crypto';
import type { CreatedWebhook, CreateWebhookRequest, UpdateWebhookRequest, Webhook, WebhookEventType, WebhookList } from '@absah/contracts';
import { WEBHOOK_MAX_ENDPOINTS, WEBHOOK_SECRET_PREFIX } from '@absah/contracts';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { canManageIntegrations } from '../domain/policies';
import { webhookUrlPreview, webhookUrlProblem, type UrlProblem } from '../domain/webhook-url';
import { deleteWebhook, findWebhook, insertWebhook, listWebhooks, updateWebhook, webhookCount, type WebhookRow } from '../infrastructure/webhook-repo';

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
