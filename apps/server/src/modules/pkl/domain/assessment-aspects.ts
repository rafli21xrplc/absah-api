import { PKL_ASPECT_MAX } from '@absah/contracts';

/** Planning of PUT /pkl/assessment-aspects (PKL-04): which aspects are added, edited and retired. Pure. */

export interface AspectInput {
  id?: string | undefined;
  name: string;
  description?: string | null | undefined;
  weight: number;
}

export interface ExistingAspect {
  id: string;
  name: string;
  description: string | null;
  weight: number;
  position: number;
}

export interface AspectPlan {
  /** Existing aspects to rewrite (name, description, weight, position), including those that only moved. */
  update: { id: string; name: string; description: string | null; weight: number; position: number }[];
  insert: { name: string; description: string | null; weight: number; position: number }[];
  /** Existing active aspects not in the list. */
  retire: string[];
}

export type AspectProblem = { kind: 'unknown_id'; id: string } | { kind: 'duplicate_id'; id: string } | { kind: 'duplicate_name'; name: string } | { kind: 'too_many' };

const key = (name: string) => name.trim().toLowerCase();

/**
 * The list is the new form, in order (position = index). Only active aspects may be edited; a name is unique among the list,
 * ignoring case. Returns the problems found instead of a plan when the list cannot be applied.
 */
export function planAspects(existing: readonly ExistingAspect[], input: readonly AspectInput[]): { plan: AspectPlan; problems: [] } | { plan: null; problems: AspectProblem[] } {
  const problems: AspectProblem[] = [];
  if (input.length > PKL_ASPECT_MAX) problems.push({ kind: 'too_many' });
  const known = new Set(existing.map((e) => e.id));
  const seenIds = new Set<string>();
  const seenNames = new Set<string>();
  for (const item of input) {
    if (item.id) {
      if (!known.has(item.id)) problems.push({ kind: 'unknown_id', id: item.id });
      else if (seenIds.has(item.id)) problems.push({ kind: 'duplicate_id', id: item.id });
      seenIds.add(item.id);
    }
    const name = key(item.name);
    if (seenNames.has(name)) problems.push({ kind: 'duplicate_name', name: item.name.trim() });
    seenNames.add(name);
  }
  if (problems.length > 0) return { plan: null, problems };
  const plan: AspectPlan = { update: [], insert: [], retire: existing.filter((e) => !seenIds.has(e.id)).map((e) => e.id) };
  input.forEach((item, position) => {
    const fields = { name: item.name.trim(), description: item.description?.trim() || null, weight: item.weight, position };
    if (item.id) plan.update.push({ id: item.id, ...fields });
    else plan.insert.push(fields);
  });
  return { plan, problems: [] };
}
