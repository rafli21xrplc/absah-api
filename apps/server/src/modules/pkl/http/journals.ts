import {
  CreatePklAttachmentRequest,
  CreatePklAttachmentResponse,
  PklAttachmentLink,
  PklJournal,
  PklJournalIdParam,
  PklJournalList,
  PklJournalQuery,
  ReviewPklJournalRequest,
  WritePklJournalRequest,
} from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import type { ObjectStorage } from '../../../shared/storage';
import { resolveContext, type Auth } from '../../platform';
import { createPklAttachment, listPklJournals, pklAttachmentLink, reviewPklJournal, writePklJournal } from '../application/journals';
import { todayOf } from './clock';

/** Jurnal PKL (PKL-03), behind pkl.enabled. */
export function pklJournalsRouter(auth: Auth, storage: ObjectStorage): Router {
  const router = Router();
  const pkl = [resolveContext(auth, { school: 'required' }), requireCap('pkl.enabled')];

  router.get('/pkl/journals', ...pkl, async (req, res) => {
    sendContract(res, PklJournalList, await listPklJournals(getActor(req), todayOf(req), PklJournalQuery.parse(req.query)));
  });
  router.post('/pkl/journals/attachments', ...pkl, idempotent(), async (req, res) => {
    sendContract(res, CreatePklAttachmentResponse, await createPklAttachment(getActor(req), storage, CreatePklAttachmentRequest.parse(req.body)), 201);
  });
  router.post('/pkl/journals', ...pkl, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, PklJournal, await writePklJournal(actor, auditContext(req, actor), storage, todayOf(req), WritePklJournalRequest.parse(req.body)));
  });
  router.post('/pkl/journals/:journalId/review', ...pkl, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const { journalId } = PklJournalIdParam.parse(req.params);
    sendContract(res, PklJournal, await reviewPklJournal(actor, auditContext(req, actor), journalId, ReviewPklJournalRequest.parse(req.body)));
  });
  router.get('/pkl/journals/:journalId/attachment', ...pkl, async (req, res) => {
    sendContract(res, PklAttachmentLink, await pklAttachmentLink(getActor(req), storage, PklJournalIdParam.parse(req.params).journalId));
  });

  return router;
}
