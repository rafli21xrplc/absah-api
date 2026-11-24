import { PrincipalDashboard } from '@absah/contracts';
import { Router } from 'express';
import { getActor, getCtx } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { resolveContext, type Auth } from '../../platform';
import { principalDashboard } from '../application/dashboard';

/** Dasbor kepala sekolah (RKP-05). The optional parts follow the school's capabilities. */
export function dashboardRouter(auth: Auth): Router {
  const router = Router();
  router.get('/dashboard/principal', resolveContext(auth, { school: 'required' }), async (req, res) => {
    const caps = getCtx(req).caps;
    sendContract(res, PrincipalDashboard, await principalDashboard(getActor(req), { earlyWarning: caps['student.early_warning'] === true, mbg: caps['mbg.enabled'] === true }));
  });
  return router;
}
