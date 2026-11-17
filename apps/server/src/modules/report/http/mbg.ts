import { MbgDaily, MbgDailyQuery, MbgSettings, UpdateMbgSettingsRequest } from '@absah/contracts';
import { Router } from 'express';
import { auditContext } from '../../../shared/audit';
import { requireCap } from '../../../shared/capability';
import { getActor } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { idempotent } from '../../../shared/idempotency';
import { resolveContext, type Auth } from '../../platform';
import { getMbgSettings, mbgDaily, updateMbgSettings } from '../application/mbg';

/** Jumlah hadir MBG (RKP-08), only for schools that receive MBG (mbg.enabled). */
export function mbgRouter(auth: Auth): Router {
  const router = Router();
  const school = [resolveContext(auth, { school: 'required' }), requireCap('mbg.enabled')];

  router.get('/mbg/daily', ...school, async (req, res) => {
    const { date } = MbgDailyQuery.parse(req.query);
    sendContract(res, MbgDaily, await mbgDaily(getActor(req), date));
  });

  router.get('/mbg/settings', ...school, async (req, res) => {
    sendContract(res, MbgSettings, await getMbgSettings(getActor(req)));
  });

  router.put('/mbg/settings', ...school, idempotent(), async (req, res) => {
    const actor = getActor(req);
    sendContract(res, MbgSettings, await updateMbgSettings(actor, auditContext(req, actor), UpdateMbgSettingsRequest.parse(req.body)));
  });

  return router;
}
