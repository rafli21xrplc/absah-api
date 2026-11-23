import { CollectionDashboardList, PrincipalDashboard } from '@absah/contracts';
import { Router } from 'express';
import { getActor, getCtx } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { resolveContext, type Auth } from '../../platform';
import { collectionDashboards } from '../application/collection-dashboard';
import { principalDashboard } from '../application/dashboard';

/** Dasbor kepala sekolah (RKP-05). The optional parts follow the school's capabilities. */
export function dashboardRouter(auth: Auth): Router {
  const router = Router();
  router.get('/dashboard/principal', resolveContext(auth, { school: 'required' }), async (req, res) => {
    const caps = getCtx(req).caps;
    sendContract(res, PrincipalDashboard, await principalDashboard(getActor(req), { earlyWarning: caps['student.early_warning'] === true, mbg: caps['mbg.enabled'] === true }));
  });
  // Across schools, so no X-School-Id: every school is read in its own tenant, as the caller, for the schools they lead.
  router.get('/dashboard/collections', resolveContext(auth, { school: 'optional' }), async (req, res) => {
    const { user } = getCtx(req);
    sendContract(res, CollectionDashboardList, await collectionDashboards({ id: user.id, twoFactorEnabled: user.twoFactorEnabled }));
  });
  return router;
}
