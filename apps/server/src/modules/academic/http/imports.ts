import { CreateImportRequest, CreateImportResponse, ImportIdParam, StudentImportList, StudentImportResponse } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCapValue } from '../../../shared/capability';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import type { ObjectStorage } from '../../../shared/storage';
import { resolveContext, type Auth } from '../../platform';
import { commitStudentImport } from '../application/commit-student-import';
import { createStudentImport, getStudentImport, listStudentImports, requestImportParse } from '../application/student-import';

export function importsRouter(auth: Auth, storage: ObjectStorage): Router {
  const router = Router();
  const school = resolveContext(auth, { school: 'required' });

  router.post('/imports/dapodik', school, requireCapValue('data.source', 'dapodik'), idempotent(), async (req, res) => {
    const input = CreateImportRequest.parse(req.body);
    sendContract(res, CreateImportResponse, await createStudentImport(getActor(req), storage, 'dapodik', input), 201);
  });

  router.post('/imports/:importId/parse', school, async (req, res) => {
    const { importId } = ImportIdParam.parse(req.params);
    sendContract(res, StudentImportResponse, await requestImportParse(getActor(req), importId));
  });

  router.post('/imports/:importId/commit', school, idempotent(), async (req, res) => {
    const { importId } = ImportIdParam.parse(req.params);
    const actor = getActor(req);
    sendContract(res, StudentImportResponse, await commitStudentImport(actor, auditContext(req, actor), storage, importId, req.log));
  });

  router.get('/imports/:importId', school, async (req, res) => {
    const { importId } = ImportIdParam.parse(req.params);
    sendContract(res, StudentImportResponse, await getStudentImport(getActor(req), importId));
  });

  router.get('/imports', school, async (req, res) => {
    sendContract(res, StudentImportList, await listStudentImports(getActor(req)));
  });

  return router;
}
