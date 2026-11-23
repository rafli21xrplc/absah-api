import { SaveTracerResponseRequest, TracerFormContext } from '@absah/contracts';
import { Router, type Request } from 'express';
import { UnauthenticatedError } from '../../../shared/errors';
import { sendContract } from '../../../shared/http';
import { saveTracerForm, tracerFormContext, type TracerLinkMeta } from '../application/tracer-form';

/** Scheme of the Authorization header that carries a tracer link token (kept out of URLs and logs). */
export const TRACER_AUTH_SCHEME = 'Tracer';

function tokenOf(req: Request): string {
  const [scheme, token] = (req.get('authorization') ?? '').split(' ');
  if (scheme !== TRACER_AUTH_SCHEME || !token) throw new UnauthenticatedError('Tautan tidak dikenal.');
  return token;
}
const metaOf = (req: Request): TracerLinkMeta => ({ requestId: req.requestId, ip: req.clientIp ?? null });

/** Calls from the alumni page (PKL-05); no session, the link token is the credential. */
export function pklTracerFormRouter(): Router {
  const router = Router();
  router.get('/tracer/form', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    sendContract(res, TracerFormContext, await tracerFormContext(tokenOf(req)));
  });
  router.put('/tracer/form', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    sendContract(res, TracerFormContext, await saveTracerForm(tokenOf(req), metaOf(req), SaveTracerResponseRequest.parse(req.body)));
  });
  return router;
}
