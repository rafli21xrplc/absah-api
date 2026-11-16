import {
  AcceptInvitationRequest,
  AcceptInvitationResponse,
  CreateInvitationRequest,
  InvitationPreviewResponse,
  InvitationResponse,
  InvitationTokenRequest,
} from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { acceptInvitation, inviteMember, previewInvitation } from '../application/invitations';
import type { Auth } from '../infrastructure/auth';
import { resolveContext } from './context';

/** appUrl: the web origin the invite link points to (BETTER_AUTH_URL). */
export function invitationsRouter(auth: Auth, appUrl: string): Router {
  const router = Router();

  router.post('/school/invitations', resolveContext(auth, { school: 'required' }), idempotent(), async (req, res) => {
    const input = CreateInvitationRequest.parse(req.body);
    const actor = getActor(req);
    sendContract(res, InvitationResponse, await inviteMember(auth, actor, auditContext(req, actor), input, appUrl), 201);
  });

  // Public: the token is the credential (256 random bits, 7 days, single use).
  router.post('/invitations/preview', async (req, res) => {
    const { token } = InvitationTokenRequest.parse(req.body);
    sendContract(res, InvitationPreviewResponse, await previewInvitation(auth, token));
  });

  router.post('/invitations/accept', async (req, res) => {
    const input = AcceptInvitationRequest.parse(req.body);
    const meta = { requestId: req.requestId, ip: req.clientIp ?? null };
    sendContract(res, AcceptInvitationResponse, await acceptInvitation(auth, input, meta));
  });

  return router;
}
