import { CounselingNote, CounselingNoteIdParam, CounselingNoteList, CounselingNotesQuery, CreateCounselingNoteRequest } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { completeCounselingFollowUp, listCounselingNotes, recordCounselingNote } from '../application/counseling';
import { todayOf } from './clock';

/** BK notes (KSW-05), behind student.counseling. */
export function counselingRouter(auth: Auth): Router {
  const router = Router();
  const bk = [resolveContext(auth, { school: 'required' }), requireCap('student.counseling')];

  router.get('/counseling-notes', ...bk, async (req, res) => {
    const actor = getActor(req);
    sendContract(res, CounselingNoteList, await listCounselingNotes(actor, auditContext(req, actor), CounselingNotesQuery.parse(req.query)));
  });
  router.post('/counseling-notes', ...bk, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, CounselingNote, await recordCounselingNote(actor, auditContext(req, actor), todayOf(req), CreateCounselingNoteRequest.parse(req.body)), 201);
  });
  router.post('/counseling-notes/:noteId/complete', ...bk, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, CounselingNote, await completeCounselingFollowUp(actor, auditContext(req, actor), CounselingNoteIdParam.parse(req.params).noteId));
  });

  return router;
}
