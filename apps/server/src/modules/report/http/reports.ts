import { ClassRecapDetail, ClassRecapList, RecapClassIdParam, ReportPeriodQuery, ReportSemesterList, SessionCompliance } from '@absah/contracts';
import { Router } from 'express';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { resolveContext, type Auth } from '../../platform';
import { classRecap, classRecaps, listSemesters, sessionCompliance } from '../application/recap';

/** Rekap and compliance reads (RKP-01, RKP-02, RKP-04). */
export function reportsRouter(auth: Auth): Router {
  const router = Router();
  const school = resolveContext(auth, { school: 'required' });

  router.get('/reports/semesters', school, async (req, res) => {
    sendContract(res, ReportSemesterList, await listSemesters(getActor(req)));
  });

  router.get('/reports/attendance/classes', school, async (req, res) => {
    sendContract(res, ClassRecapList, await classRecaps(getActor(req), ReportPeriodQuery.parse(req.query)));
  });

  router.get('/reports/attendance/classes/:classId', school, async (req, res) => {
    const { classId } = RecapClassIdParam.parse(req.params);
    sendContract(res, ClassRecapDetail, await classRecap(getActor(req), classId, ReportPeriodQuery.parse(req.query)));
  });

  router.get('/reports/session-compliance', school, async (req, res) => {
    sendContract(res, SessionCompliance, await sessionCompliance(getActor(req), ReportPeriodQuery.parse(req.query)));
  });

  return router;
}
