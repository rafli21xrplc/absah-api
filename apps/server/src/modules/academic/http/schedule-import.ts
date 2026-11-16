import { CommitScheduleImportRequest, CreateScheduleImportRequest, CreateScheduleImportResponse, ScheduleImportPreview, ScheduleImportResult, UploadIdParam } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import type { ObjectStorage } from '../../../shared/storage';
import { resolveContext, type Auth } from '../../platform';
import { commitScheduleImport, createScheduleImport, previewScheduleImport, scheduleTemplate } from '../application/schedule-import';

export function scheduleImportRouter(auth: Auth, storage: ObjectStorage): Router {
  const router = Router();
  const school = resolveContext(auth, { school: 'required' });

  router.get('/schedule/template.xlsx', school, async (req, res) => {
    const file = await scheduleTemplate(getActor(req));
    res
      .status(200)
      .set({
        'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'Content-Disposition': 'attachment; filename="template-jadwal-absah.xlsx"',
        'Cache-Control': 'no-store',
      })
      .send(file);
  });

  router.post('/schedule/imports', school, idempotent(), async (req, res) => {
    sendContract(res, CreateScheduleImportResponse, await createScheduleImport(getActor(req), storage, CreateScheduleImportRequest.parse(req.body)));
  });

  router.post('/schedule/imports/:uploadId/preview', school, async (req, res) => {
    const { uploadId } = UploadIdParam.parse(req.params);
    sendContract(res, ScheduleImportPreview, await previewScheduleImport(getActor(req), storage, uploadId));
  });

  router.post('/schedule/imports/:uploadId/commit', school, idempotent(), async (req, res) => {
    const { uploadId } = UploadIdParam.parse(req.params);
    const { fingerprint } = CommitScheduleImportRequest.parse(req.body);
    const actor = getActor(req);
    sendContract(res, ScheduleImportResult, await commitScheduleImport(actor, auditContext(req, actor), storage, uploadId, fingerprint, req.log));
  });

  return router;
}
