import { CreateCharacterReportRequest, CreateExportRequest, ExportDownload, ExportIdParam, ExportJob, ExportJobList } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { getActor, getCtx } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import type { ObjectStorage } from '../../../shared/storage';
import { resolveContext, type Auth } from '../../platform';
import { requestCharacterReport } from '../application/character-report';
import { downloadExport, getExport, listExports, requestExport } from '../application/exports';

/** Semester rekap files (RKP-02, RKP-03): queued here, built by the worker, downloaded presigned. */
export function exportsRouter(auth: Auth, storage: ObjectStorage): Router {
  const router = Router();
  const school = resolveContext(auth, { school: 'required' });

  router.post('/exports', school, idempotent(), async (req, res) => {
    const actor = getActor(req);
    const target = getCtx(req).caps['report.target'] ?? 'erapor';
    sendContract(res, ExportJob, await requestExport(actor, auditContext(req, actor), target, CreateExportRequest.parse(req.body)), 202);
  });

  router.post('/exports/character-reports', school, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, ExportJob, await requestCharacterReport(actor, auditContext(req, actor), CreateCharacterReportRequest.parse(req.body)), 202);
  });

  router.get('/exports', school, async (req, res) => {
    sendContract(res, ExportJobList, await listExports(getActor(req)));
  });

  router.get('/exports/:exportId', school, async (req, res) => {
    const { exportId } = ExportIdParam.parse(req.params);
    sendContract(res, ExportJob, await getExport(getActor(req), exportId));
  });

  router.get('/exports/:exportId/download', school, async (req, res) => {
    const { exportId } = ExportIdParam.parse(req.params);
    sendContract(res, ExportDownload, await downloadExport(getActor(req), exportId, storage));
  });

  return router;
}
