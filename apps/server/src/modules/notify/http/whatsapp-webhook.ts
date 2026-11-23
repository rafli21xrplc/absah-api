import { createHmac, timingSafeEqual } from 'node:crypto';
import express, { Router } from 'express';
import { NotFoundError, UnauthenticatedError } from '../../../shared/errors';
import { recordStatusUpdates } from '../application/webhooks';
import { parseMetaStatuses } from '../domain/status';

export interface WhatsappWebhookConfig {
  /** Verifies X-Hub-Signature-256 (HMAC-SHA256 of the raw body). */
  appSecret: string;
  /** Echo check when the URL is registered at the provider. */
  verifyToken: string;
}

/** Constant-time check of "sha256=<hex>" against the raw body. */
export function validSignature(raw: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', appSecret).update(raw).digest();
  const given = Buffer.from(header.slice(7), 'hex');
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Status webhooks (NTF). Mounted before express.json(): the signature covers the raw body. The
 * request only verifies and stores (inbox_webhooks, one row per message id + status); the worker
 * applies them. Without configuration the route does not exist.
 */
export function whatsappWebhookRouter(config: WhatsappWebhookConfig | undefined): Router {
  const router = Router();
  router.get('/', (req, res) => {
    if (!config) throw new NotFoundError('Tidak ditemukan.');
    if (req.query['hub.mode'] !== 'subscribe' || req.query['hub.verify_token'] !== config.verifyToken) throw new UnauthenticatedError();
    const challenge = req.query['hub.challenge'];
    res.type('text/plain').send(typeof challenge === 'string' ? challenge : '');
  });
  router.post('/', express.raw({ type: '*/*', limit: '1mb' }), async (req, res) => {
    if (!config) throw new NotFoundError('Tidak ditemukan.');
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!validSignature(raw, req.get('x-hub-signature-256'), config.appSecret)) throw new UnauthenticatedError();
    let body: unknown;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      body = null;
    }
    await recordStatusUpdates(parseMetaStatuses(body));
    res.status(200).json({ ok: true });
  });
  return router;
}
