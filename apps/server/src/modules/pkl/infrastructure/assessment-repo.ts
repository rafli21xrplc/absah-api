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

const asm = schema.pklAssessments;
const sc = schema.pklAssessmentScores;

export interface StoredAssessment {
  placementId: string;
  note: string | null;
  updatedAt: Date;
  scores: { aspectId: string; aspectName: string; weight: number; score: number }[];
}

/** The assessments of these placements, with their scores in the order the aspects were asked. */
export async function assessmentsOf(tx: Tx, placementIds: string[]): Promise<Map<string, StoredAssessment>> {
  const out = new Map<string, StoredAssessment>();
  if (placementIds.length === 0) return out;
  const rows = await tx.select({ id: asm.id, placementId: asm.placementId, note: asm.note, updatedAt: asm.updatedAt }).from(asm).where(inArray(asm.placementId, placementIds));
  if (rows.length === 0) return out;
  const scores = await tx
    .select({ assessmentId: sc.assessmentId, aspectId: sc.aspectId, aspectName: sc.aspectName, weight: sc.weight, score: sc.score, position: a.position })
    .from(sc)
    .innerJoin(a, eq(a.id, sc.aspectId))
    .where(inArray(sc.assessmentId, rows.map((r) => r.id)))
    .orderBy(asc(a.position), asc(sc.aspectName));
  for (const r of rows) {
    out.set(r.placementId, { placementId: r.placementId, note: r.note, updatedAt: r.updatedAt, scores: scores.filter((s) => s.assessmentId === r.id).map(({ assessmentId: _id, position: _p, ...s }) => s) });
  }
  return out;
}

/** Gives or corrects the assessment of a placement: one row per placement, scores replaced with the aspects' current name and weight. */
export async function saveAssessment(
  tx: Tx,
  input: { schoolId: string; placementId: string; assessedBy: string; note: string | null; scores: { aspectId: string; aspectName: string; weight: number; score: number }[]; newId: string },
): Promise<void> {
  const [row] = await tx
    .insert(asm)
    .values({ id: input.newId, schoolId: input.schoolId, placementId: input.placementId, assessedBy: input.assessedBy, note: input.note })
    .onConflictDoUpdate({ target: asm.placementId, set: { assessedBy: input.assessedBy, note: input.note, updatedAt: sql`now()` } })
    .returning({ id: asm.id });
  const id = row?.id ?? input.newId;
  await tx.delete(sc).where(eq(sc.assessmentId, id));
  await tx.insert(sc).values(input.scores.map((s) => ({ schoolId: input.schoolId, assessmentId: id, ...s })));
}

export async function schoolName(tx: Tx, schoolId: string): Promise<string> {
  const [row] = await tx.select({ name: schema.schools.name }).from(schema.schools).where(eq(schema.schools.id, schoolId));
  return row?.name ?? '';
}
