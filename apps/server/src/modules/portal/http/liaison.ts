import { LiaisonMessageParam, LiaisonStudentParam, LiaisonThread, LiaisonThreadList, PostLiaisonMessageRequest } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { getThread, listThreads, postMessage, readThread, retract } from '../application/liaison';

/** Buku penghubung (ORT-07): orang tua in the PWA, wali kelas and guru mapel on the staff web. */
export function liaisonRouter(auth: Auth): Router {
  const router = Router();
  const guard = [resolveContext(auth, { school: 'required' }), requireCap('portal.liaison')];

  router.get('/liaison/threads', ...guard, async (req, res) => {
    sendContract(res, LiaisonThreadList, await listThreads(getActor(req)));
  });
  router.get('/liaison/students/:studentId', ...guard, async (req, res) => {
    const actor = getActor(req);
    sendContract(res, LiaisonThread, await getThread(actor, auditContext(req, actor), LiaisonStudentParam.parse(req.params).studentId));
  });
  router.post('/liaison/students/:studentId/messages', ...guard, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const { studentId } = LiaisonStudentParam.parse(req.params);
    sendContract(res, LiaisonThread, await postMessage(actor, auditContext(req, actor), studentId, PostLiaisonMessageRequest.parse(req.body)));
  });
  // Marking read twice is harmless, so no Idempotency-Key.
  router.post('/liaison/students/:studentId/read', ...guard, async (req, res) => {
    await readThread(getActor(req), LiaisonStudentParam.parse(req.params).studentId);
    res.status(204).end();
  });
  router.post('/liaison/messages/:messageId/retract', ...guard, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, LiaisonThread, await retract(actor, auditContext(req, actor), LiaisonMessageParam.parse(req.params).messageId));
  });

  return router;
}
