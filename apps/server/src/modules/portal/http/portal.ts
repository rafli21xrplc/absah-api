import { PortalAttendance } from '@absah/contracts';
import { Router } from 'express';
import { getActor, getCtx } from '../../../shared/context';
import { sendContract } from '../../../shared/http';
import { resolveContext, type Auth } from '../../platform';
import { portalAttendance } from '../application/attendance';

/** Signed-in siswa and orang tua (PWA, ORT-02). */
export function portalRouter(auth: Auth): Router {
  const router = Router();
  const school = resolveContext(auth, { school: 'required' });
  router.get('/portal/attendance', school, async (req, res) => {
    const ctx = getCtx(req);
    const timezone = ctx.memberships.find((m) => m.schoolId === ctx.schoolId)?.timezone ?? 'Asia/Jakarta';
    sendContract(res, PortalAttendance, await portalAttendance(getActor(req), timezone));
  });
  return router;
}
