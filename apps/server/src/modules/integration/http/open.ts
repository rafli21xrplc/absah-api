import { OpenDailyAttendance, OpenDailyAttendanceQuery } from '@absah/contracts';
import { Router } from 'express';
import { sendContract } from '../../../shared/http';
import { openDailyAttendance } from '../application/open-attendance';
import { KeyRateLimiter } from '../domain/rate-limit';
import { getApiKeyCaller, requireApiKey } from './api-key-auth';

/** The open API for third parties (PLT-09): read-only, no names, authenticated by API key. One limiter for the whole process. */
export function openRouter(limiter: KeyRateLimiter = new KeyRateLimiter()): Router {
  const router = Router();
  router.get('/open/attendance/daily', requireApiKey('attendance:read', limiter), async (req, res) => {
    sendContract(res, OpenDailyAttendance, await openDailyAttendance(getApiKeyCaller(req), OpenDailyAttendanceQuery.parse(req.query)));
  });
  return router;
}
