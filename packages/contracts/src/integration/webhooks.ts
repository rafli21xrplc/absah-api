import { z } from 'zod';

/**
 * Outgoing webhooks (PLT-09), behind the capability platform.openApi. The admin gives an HTTPS address and picks events;
 * every delivery is signed with the endpoint's secret (shown once). v1 events are about attendance only and carry ids,
 * never a name: the receiver asks the open API (or its own roster) for anything more.
 */

export const WEBHOOK_EVENTS = ['attendance.absent_marked', 'attendance.session_locked', 'leave.approved', 'leave.cancelled'] as const;
export const WebhookEventType = z.enum(WEBHOOK_EVENTS).meta({ id: 'WebhookEventType' });
export type WebhookEventType = z.infer<typeof WebhookEventType>;

/** Endpoints per school: a handful of systems, not a fan-out. */
export const WEBHOOK_MAX_ENDPOINTS = 5;
export const WEBHOOK_SECRET_PREFIX = 'whsec_';
export const WEBHOOK_URL_MAX = 500;

/** The shape only (https, no credentials in the address). Private and loopback hosts are refused by the server. */
export const WebhookUrl = z
  .string()
  .trim()
  .max(WEBHOOK_URL_MAX, 'Alamat terlalu panjang.')
  .refine((v) => URL.canParse(v), 'Alamat tidak valid.')
  .refine((v) => !URL.canParse(v) || new URL(v).protocol === 'https:', 'Alamat harus diawali https://.')
  .refine((v) => !URL.canParse(v) || (new URL(v).username === '' && new URL(v).password === ''), 'Alamat tidak boleh memuat nama pengguna atau kata sandi.')
  .meta({ id: 'WebhookUrl' });

const Events = z.array(WebhookEventType).min(1, 'Pilih minimal satu kejadian.').max(WEBHOOK_EVENTS.length);

export const Webhook = z
  .object({
    id: z.uuid(),
    /** Scheme and host only (the path may carry a token, so it is never shown again). */
    urlPreview: z.string(),
    events: z.array(WebhookEventType),
    active: z.boolean(),
    createdAt: z.iso.datetime({ offset: true }),
    updatedAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'Webhook' });
export type Webhook = z.infer<typeof Webhook>;

export const WebhookList = z.object({ items: z.array(Webhook) }).meta({ id: 'WebhookList' });
export type WebhookList = z.infer<typeof WebhookList>;

export const CreateWebhookRequest = z.object({ url: WebhookUrl, events: Events }).strict().meta({ id: 'CreateWebhookRequest' });
export type CreateWebhookRequest = z.infer<typeof CreateWebhookRequest>;

export const UpdateWebhookRequest = z
  .object({ url: WebhookUrl.optional(), events: Events.optional(), active: z.boolean().optional() })
  .strict()
  .refine((v) => v.url !== undefined || v.events !== undefined || v.active !== undefined, 'Tidak ada yang diubah.')
  .meta({ id: 'UpdateWebhookRequest' });
export type UpdateWebhookRequest = z.infer<typeof UpdateWebhookRequest>;

/** POST /api/v1/integrations/webhooks: the signing secret, shown only here. */
export const CreatedWebhook = Webhook.extend({ secret: z.string() }).meta({ id: 'CreatedWebhook' });
export type CreatedWebhook = z.infer<typeof CreatedWebhook>;

export const WebhookIdParam = z.object({ webhookId: z.uuid() });
