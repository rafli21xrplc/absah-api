import { ActionLinkCardRequest, ActionLinkContext, ActionLinkLeave, ActionLinkLeaveRequest, CardDeviceKeys } from '@absah/contracts';
import { Router, type Request } from 'express';
import { UnauthenticatedError } from '../../../shared/errors';
import { sendContract } from '../../../shared/http';
import { linkCard, linkContext, linkLeave, type LinkRequestMeta } from '../application/links';

/** Scheme of the Authorization header that carries an action link token (kept out of URLs and logs). */
export const LINK_AUTH_SCHEME = 'Link';

function tokenOf(req: Request): string {
  const [scheme, token] = (req.get('authorization') ?? '').split(' ');
  if (scheme !== LINK_AUTH_SCHEME || !token) throw new UnauthenticatedError('Tautan tidak dikenal.');
  return token;
}
const metaOf = (req: Request): LinkRequestMeta => ({ requestId: req.requestId, ip: req.clientIp ?? null });

/** Calls from the action link page (ORT-01); no session, the link token is the credential. */
export function linksRouter(): Router {
  const router = Router();
  router.get('/links/context', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    sendContract(res, ActionLinkContext, await linkContext(tokenOf(req)));
  });
  router.post('/links/leave', async (req, res) => {
    sendContract(res, ActionLinkLeave, await linkLeave(tokenOf(req), metaOf(req), ActionLinkLeaveRequest.parse(req.body)), 201);
  });
  router.post('/links/card', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    sendContract(res, CardDeviceKeys, await linkCard(tokenOf(req), metaOf(req), ActionLinkCardRequest.parse(req.body ?? {})));
  });
  return router;
}
