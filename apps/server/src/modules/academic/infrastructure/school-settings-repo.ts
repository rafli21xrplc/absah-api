import type { Level } from '@absah/capabilities';
import { schema, type Tx } from '@absah/db';
import { and, eq, sql } from 'drizzle-orm';
import type { OverridePlan } from '../domain/capability-settings';

export interface StoredProfile {
  level: Level;
  isMadrasah: boolean;
  timezone: string;
}

/** Profile of the active school. RLS also shows other schools of the user, so filter by id. */
export async function lockSchoolProfile(tx: Tx, schoolId: string): Promise<StoredProfile | undefined> {
  const [row] = await tx
    .select({ level: schema.schools.level, isMadrasah: schema.schools.isMadrasah, timezone: schema.schools.timezone })
    .from(schema.schools)
    .where(eq(schema.schools.id, schoolId))
    .for('update');
  return row;
}

export async function updateSchoolProfile(
  tx: Tx,
  schoolId: string,
  profile: { level: Level; isMadrasah: boolean },
): Promise<void> {
  await tx.update(schema.schools).set(profile).where(eq(schema.schools.id, schoolId));
}

export async function saveOverride(
  tx: Tx,
  schoolId: string,
  key: string,
  plan: OverridePlan,
  userId: string,
): Promise<void> {
  const t = schema.schoolCapabilities;
  if (plan === null) {
    await tx.delete(t).where(and(eq(t.schoolId, schoolId), eq(t.key, key)));
    return;
  }
  const row = { ...plan, updatedBy: userId, updatedAt: sql`now()` };
  await tx
    .insert(t)
    .values({ schoolId, key, ...row })
    .onConflictDoUpdate({ target: [t.schoolId, t.key], set: row });
}
