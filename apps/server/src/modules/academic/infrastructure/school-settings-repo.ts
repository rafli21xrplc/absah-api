import type { Level } from '@absah/capabilities';
import { schema, type Tx } from '@absah/db';
import { and, eq, sql } from 'drizzle-orm';
import type { OverridePlan } from '../domain/capability-settings';

export interface StoredProfile {
  name: string;
  npsn: string | null;
  nsm: string | null;
  timezone: string;
  level: Level;
  isMadrasah: boolean;
}

/** Profile of the active school. RLS also shows other schools of the user, so filter by id. */
export async function lockSchoolProfile(tx: Tx, schoolId: string): Promise<StoredProfile | undefined> {
  const [row] = await tx
    .select({
      name: schema.schools.name,
      npsn: schema.schools.npsn,
      nsm: schema.schools.nsm,
      timezone: schema.schools.timezone,
      level: schema.schools.level,
      isMadrasah: schema.schools.isMadrasah,
    })
    .from(schema.schools)
    .where(eq(schema.schools.id, schoolId))
    .for('update');
  return row;
}

export async function updateSchoolProfile(
  tx: Tx,
  schoolId: string,
  profile: Partial<StoredProfile>,
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

export async function readSetup(tx: Tx, schoolId: string) {
  const [row] = await tx.select().from(schema.schoolSetup).where(eq(schema.schoolSetup.schoolId, schoolId));
  return row;
}

export async function saveSetup(
  tx: Tx,
  schoolId: string,
  patch: { steps?: Record<string, 'done' | 'skipped'>; completedAt?: Date },
): Promise<void> {
  const set = { ...patch, updatedAt: sql`now()` };
  await tx
    .insert(schema.schoolSetup)
    .values({ schoolId, steps: patch.steps ?? {}, completedAt: patch.completedAt })
    .onConflictDoUpdate({ target: schema.schoolSetup.schoolId, set });
}
