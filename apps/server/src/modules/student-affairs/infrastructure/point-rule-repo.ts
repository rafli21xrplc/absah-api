import { schema, type Tx } from '@absah/db';
import type { PointKind } from '@absah/contracts';
import { asc, desc, eq } from 'drizzle-orm';

const r = schema.pointRules;

const columns = { id: r.id, kind: r.kind, category: r.category, name: r.name, points: r.points, active: r.active };
export type PointRuleRow = { id: string; kind: PointKind; category: string; name: string; points: number; active: boolean };

/** Pelanggaran first (kind enum order is violation, achievement), then category and name. */
export function listRules(tx: Tx, includeInactive: boolean): Promise<PointRuleRow[]> {
  const query = tx.select(columns).from(r);
  return (includeInactive ? query : query.where(eq(r.active, true))).orderBy(asc(r.kind), asc(r.category), asc(r.name), desc(r.id));
}

export async function findRule(tx: Tx, id: string): Promise<PointRuleRow | undefined> {
  const [row] = await tx.select(columns).from(r).where(eq(r.id, id));
  return row;
}

export function insertRule(tx: Tx, row: { id: string; schoolId: string; kind: PointKind; category: string; name: string; points: number; createdBy: string }) {
  return tx.insert(r).values(row);
}

export function updateRule(tx: Tx, id: string, fields: { category?: string; name?: string; points?: number; active?: boolean }) {
  return tx.update(r).set({ ...fields, updatedAt: new Date() }).where(eq(r.id, id));
}
