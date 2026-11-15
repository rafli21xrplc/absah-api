import { HealthResponse } from '@absah/contracts';
import { Router } from 'express';
import { sendContract } from '../../../shared/http';

export function healthRouter(version: string): Router {
  const router = Router();
  router.get('/health', (_req, res) => {
    sendContract(res, HealthResponse, {
      status: 'ok',
      service: 'absah-api',
      version,
      time: new Date().toISOString(),
    });
  });
  return router;
}
