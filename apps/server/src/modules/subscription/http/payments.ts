import { CreatePaymentRequest, InvoiceIdParam, Payment, PaymentList } from '@absah/contracts';
import express, { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { getActor } from '../../../shared/context';
import { NotFoundError, UnauthenticatedError } from '../../../shared/errors';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import type { PaymentProvider } from '../../../shared/payments';
import { resolveContext, type Auth } from '../../platform';
import { paymentsFor, recordPaymentEvents, requestPayment } from '../application/payments';

/** Paying an invoice (BIL): the admin opens a VA or QRIS; the worker talks to the gateway. */
export function paymentsRouter(auth: Auth, provider: PaymentProvider | null): Router {
  const router = Router();
  const school = resolveContext(auth, { school: 'required' });

  router.post('/billing/invoices/:invoiceId/payments', school, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const { invoiceId } = InvoiceIdParam.parse(req.params);
    sendContract(res, Payment, await requestPayment(actor, auditContext(req, actor), provider, invoiceId, CreatePaymentRequest.parse(req.body)), 202);
  });

  router.get('/billing/invoices/:invoiceId/payments', school, async (req, res) => {
    const { invoiceId } = InvoiceIdParam.parse(req.params);
    sendContract(res, PaymentList, await paymentsFor(getActor(req), invoiceId));
  });

  return router;
}

/**
 * Gateway webhooks. Mounted before express.json(): the signature covers the raw body. Verified events
 * go to the inbox (one row per transaction and status); job bil.apply-payments applies them. Without a
 * gateway the route does not exist.
 */
export function paymentWebhookRouter(provider: PaymentProvider | null): Router {
  const router = Router();
  router.post('/', express.raw({ type: '*/*', limit: '256kb' }), async (req, res) => {
    if (!provider) throw new NotFoundError('Tidak ditemukan.');
    const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
    if (!provider.verifyWebhook(raw, req.headers)) throw new UnauthenticatedError();
    let body: unknown;
    try {
      body = JSON.parse(raw.toString('utf8'));
    } catch {
      body = null;
    }
    await recordPaymentEvents(provider, provider.parseWebhook(body));
    res.status(200).json({ ok: true });
  });
  return router;
}
