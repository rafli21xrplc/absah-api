import type { Logger } from 'pino';

export const HEARTBEAT_QUEUE = 'platform.heartbeat';

/** Example job proving the worker loop works. Replaced by real jobs from Fase 1 onwards. */
export function heartbeatHandler(logger: Logger) {
  return async (jobs: { id: string }[]): Promise<void> => {
    for (const job of jobs) logger.info({ jobId: job.id, queue: HEARTBEAT_QUEUE }, 'heartbeat');
    await Promise.resolve();
  };
}
