import { CreateWorkspaceExportRequest, WorkspaceExport, WorkspaceExportDownload, WorkspaceExportIdParam, WorkspaceExportList } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import type { ObjectStorage } from '../../../shared/storage';
import { resolveContext, type Auth } from '../../platform';
import { downloadWorkspaceExport, getWorkspaceExport, listWorkspaceExports, requestWorkspaceExport } from '../application/exports';

/** PLT-11: the school's data, as a ZIP built by the worker. Admin only. */
export function workspaceExportsRouter(auth: Auth, storage: ObjectStorage): Router {
  const router = Router();
  const school = resolveContext(auth, { school: 'required' });

  router.post('/workspace/exports', school, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, WorkspaceExport, await requestWorkspaceExport(actor, auditContext(req, actor), CreateWorkspaceExportRequest.parse(req.body ?? {})), 202);
  });
  router.get('/workspace/exports', school, async (req, res) => {
    sendContract(res, WorkspaceExportList, await listWorkspaceExports(getActor(req)));
  });
  router.get('/workspace/exports/:exportId', school, async (req, res) => {
    sendContract(res, WorkspaceExport, await getWorkspaceExport(getActor(req), WorkspaceExportIdParam.parse(req.params).exportId));
  });
  router.get('/workspace/exports/:exportId/download', school, async (req, res) => {
    const actor = getActor(req);
    sendContract(res, WorkspaceExportDownload, await downloadWorkspaceExport(actor, auditContext(req, actor), WorkspaceExportIdParam.parse(req.params).exportId, storage));
  });

  return router;
}
