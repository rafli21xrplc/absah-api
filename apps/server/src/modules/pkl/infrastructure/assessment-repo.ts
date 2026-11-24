import { schema, type Tx } from '@absah/db';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import type { AspectPlan } from '../domain/assessment-aspects';

const a = schema.pklAssessmentAspects;

/** Active aspects in form order. */
export function activeAspects(tx: Tx) {
  return tx
    .select({ id: a.id, name: a.name, description: a.description, weight: a.weight, position: a.position })
    .from(a)
    .where(eq(a.active, true))
    .orderBy(asc(a.position), asc(a.name));
}

/**
 * Applies a plan. Retiring goes first (it frees names), edits go through the aspect's id as a temporary name so two aspects can
 * swap names, then the real fields and the new aspects follow. The partial unique index on (school, lower(name)) covers active rows.
 */
export async function applyAspectPlan(tx: Tx, schoolId: string, plan: AspectPlan, newIds: string[]): Promise<void> {
  if (plan.retire.length > 0) await tx.update(a).set({ active: false, updatedAt: sql`now()` }).where(inArray(a.id, plan.retire));
  for (const u of plan.update) await tx.update(a).set({ name: u.id }).where(eq(a.id, u.id));
  for (const u of plan.update) await tx.update(a).set({ name: u.name, description: u.description, weight: u.weight, position: u.position, updatedAt: sql`now()` }).where(and(eq(a.id, u.id), eq(a.active, true)));
  if (plan.insert.length > 0) await tx.insert(a).values(plan.insert.map((i, n) => ({ id: newIds[n] ?? '', schoolId, ...i })));
}
