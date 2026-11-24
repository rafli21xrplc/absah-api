import { schema } from '@absah/db';
import { desc } from 'drizzle-orm';
import { withTenant } from '../../../shared/db';

/**
 * Dev/e2e only (CLI notify:last-link): the action link in the school's newest message, as the
 * parent would receive it. The fake sender keeps messages in memory of the worker process, so
 * end-to-end tests read the stored params instead.
 */
export function lastActionLink(schoolId: string): Promise<{ templateCode: string; link: string | null } | null> {
  return withTenant({ schoolId, userId: null }, async (tx) => {
    const n = schema.notifications;
    const [row] = await tx.select({ templateCode: n.templateCode, params: n.params }).from(n).orderBy(desc(n.createdAt)).limit(1);
    if (!row) return null;
    const params = JSON.parse(row.params.reveal()) as Record<string, unknown>;
    // The tracer invitation carries its link as `url` (it is no guardian's action link); e2e opens it like any other.
    const link = row.templateCode === 'tracer_invitation' ? params.url : params.link;
    return { templateCode: row.templateCode, link: typeof link === 'string' ? link : null };
  });
}
