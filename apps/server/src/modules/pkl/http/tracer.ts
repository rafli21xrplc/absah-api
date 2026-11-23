import {
  AlumniFromClassRequest,
  AlumniFromClassResult,
  CreateTracerAlumnusRequest,
  InviteTracerRequest,
  InviteTracerResult,
  SaveTracerResponseRequest,
  TracerAlumniList,
  TracerClassList,
  TracerAlumniQuery,
  TracerAlumnus,
  TracerAlumnusIdParam,
  TracerRecap,
} from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { alumniFromClass, createAlumnus, exportTracer, inviteAlumni, listAlumni, listTracerClasses, recap, saveResponse } from '../application/tracer';
import { todayOf } from './clock';

/** Tracer study (PKL-05), behind pkl.tracer. */
export function pklTracerRouter(auth: Auth): Router {
  const router = Router();
  const tracer = [resolveContext(auth, { school: 'required' }), requireCap('pkl.tracer')];

  router.get('/tracer/alumni', ...tracer, async (req, res) => {
    sendContract(res, TracerAlumniList, await listAlumni(getActor(req), TracerAlumniQuery.parse(req.query)));
  });
  router.post('/tracer/alumni', ...tracer, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, TracerAlumnus, await createAlumnus(actor, auditContext(req, actor), CreateTracerAlumnusRequest.parse(req.body)), 201);
  });
  router.post('/tracer/alumni/from-class', ...tracer, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, AlumniFromClassResult, await alumniFromClass(actor, auditContext(req, actor), AlumniFromClassRequest.parse(req.body)));
  });
  router.put('/tracer/alumni/:alumnusId/response', ...tracer, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const { alumnusId } = TracerAlumnusIdParam.parse(req.params);
    sendContract(res, TracerAlumnus, await saveResponse(actor, auditContext(req, actor), alumnusId, SaveTracerResponseRequest.parse(req.body)));
  });
  router.post('/tracer/invitations', ...tracer, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, InviteTracerResult, await inviteAlumni(actor, auditContext(req, actor), InviteTracerRequest.parse(req.body)), 202);
  });
  router.get('/tracer/classes', ...tracer, async (req, res) => {
    sendContract(res, TracerClassList, await listTracerClasses(getActor(req)));
  });
  router.get('/tracer/recap', ...tracer, async (req, res) => {
    sendContract(res, TracerRecap, await recap(getActor(req)));
  });
  router.get('/tracer/export.xlsx', ...tracer, async (req, res) => {
    const { file, fileName } = await exportTracer(getActor(req), todayOf(req));
    res.status(200).set({ 'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'Content-Disposition': `attachment; filename="${fileName}"`, 'Cache-Control': 'no-store' }).send(file);
  });

  return router;
}
