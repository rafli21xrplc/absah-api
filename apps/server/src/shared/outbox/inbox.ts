import { schema } from '@absah/db';
import { and, eq, isNull } from 'drizzle-orm';
import { withPlatform } from '../db';

/**
 * Stores an incoming webhook once per (provider, externalId). Webhooks arrive before we know the
 * school, so this is a platform table (withPlatform). Process the row in a job, then mark it.
 */
export async function recordWebhook(
  provider: string,
  externalId: string,
  payload: unknown,
): Promise<{ id: string; duplicate: boolean }> {
  return withPlatform(async (tx) => {
    const [inserted] = await tx
      .insert(schema.inboxWebhooks)
      .values({ provider, externalId, payload })
      .onConflictDoNothing()
      .returning({ id: schema.inboxWebhooks.id });
    if (inserted) return { id: inserted.id, duplicate: false };
    const [existing] = await tx
      .select({ id: schema.inboxWebhooks.id })
      .from(schema.inboxWebhooks)
      .where(and(eq(schema.inboxWebhooks.provider, provider), eq(schema.inboxWebhooks.externalId, externalId)));
    if (!existing) throw new Error('inbox: conflicting row vanished');
    return { id: existing.id, duplicate: true };
  });
}

/** Marks a webhook processed; false if it already was (another worker got there first). */
export async function markWebhookProcessed(id: string): Promise<boolean> {
  return withPlatform(async (tx) => {
    const rows = await tx
      .update(schema.inboxWebhooks)
      .set({ processedAt: new Date() })
      .where(and(eq(schema.inboxWebhooks.id, id), isNull(schema.inboxWebhooks.processedAt)))
      .returning({ id: schema.inboxWebhooks.id });
    return rows.length > 0;
  });
}
