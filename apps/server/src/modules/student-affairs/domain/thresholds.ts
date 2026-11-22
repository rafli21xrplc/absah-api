export interface Tier {
  id: string;
  minPoints: number;
}

/**
 * The tiers a student has just crossed: those with before < minPoints <= after, lowest first.
 * before and after are the student's net pelanggaran points of the year as positive numbers, so a
 * pelanggaran raises them and a reversal lowers them. Nothing is crossed going down or standing still;
 * a student who falls below a tier and climbs back crosses it again, and the unique task per tier per
 * enrollment keeps that from making a second task.
 */
export function crossedThresholds<T extends Tier>(before: number, after: number, tiers: readonly T[]): T[] {
  if (after <= before) return [];
  return tiers.filter((t) => before < t.minPoints && t.minPoints <= after).sort((a, b) => a.minPoints - b.minPoints);
}
