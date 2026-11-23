import { schema } from '@absah/db';
import { lt, sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { withPlatform } from '../../../shared/db';

export const IDEMPOTENCY_CLEANUP_QUEUE = 'platform.idempotency_cleanup';

/** Deletes idempotency keys past their 24 h window, across all schools (hence withPlatform). */
export async function deleteExpiredIdempotencyKeys(): Promise<number> {
  return withPlatform(async (tx) => {
    const rows = await tx
      .delete(schema.idempotencyKeys)
      .where(lt(schema.idempotencyKeys.expiresAt, sql`now()`))
      .returning({ id: schema.idempotencyKeys.id });
    return rows.length;
  });
}

export function idempotencyCleanupHandler(logger: Logger) {
  return async (): Promise<void> => {
    const deleted = await deleteExpiredIdempotencyKeys();
    logger.info({ deleted, queue: IDEMPOTENCY_CLEANUP_QUEUE }, 'expired idempotency keys deleted');
  };
}
