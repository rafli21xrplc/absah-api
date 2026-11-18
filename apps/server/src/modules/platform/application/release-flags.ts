import { isReleaseFlag, type ReleaseFlag } from '@absah/capabilities';
import { schema } from '@absah/db';
import { sql } from 'drizzle-orm';
import { withPlatform } from '../../../shared/db';

/**
 * Turns a release flag on or off for one school (or every school with schoolId null). Ops only:
 * platform_flags is the Absah team's table, written as the owner role (withPlatform), never from a request.
 */
export async function setReleaseFlag(flag: string, schoolId: string | null, on: boolean, reason: string): Promise<ReleaseFlag> {
  if (!isReleaseFlag(flag)) throw new Error(`unknown release flag ${flag}`);
  const f = schema.platformFlags;
  await withPlatform((tx) =>
    tx
      .insert(f)
      .values({ key: flag, value: on, schoolId, reason })
      .onConflictDoUpdate({ target: [f.key, f.schoolId], set: { value: sql`excluded.value`, reason: sql`excluded.reason` } }),
  );
  return flag;
}
