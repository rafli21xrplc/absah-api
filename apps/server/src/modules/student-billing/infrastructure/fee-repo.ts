import { schema, type Tx } from '@absah/db';
import type { FeeKind } from '@absah/contracts';
import { asc, eq } from 'drizzle-orm';

const f = schema.feeTypes;
const columns = { id: f.id, name: f.name, kind: f.kind, defaultAmount: f.defaultAmount, active: f.active };
export type FeeTypeRow = { id: string; name: string; kind: FeeKind; defaultAmount: number; active: boolean };

export function listFeeTypes(tx: Tx, includeInactive: boolean): Promise<FeeTypeRow[]> {
  const query = tx.select(columns).from(f);
  return (includeInactive ? query : query.where(eq(f.active, true))).orderBy(asc(f.kind), asc(f.name), asc(f.id));
}

export async function findFeeType(tx: Tx, id: string): Promise<FeeTypeRow | undefined> {
  const [row] = await tx.select(columns).from(f).where(eq(f.id, id));
  return row;
}

export function insertFeeType(tx: Tx, row: { id: string; schoolId: string; name: string; kind: FeeKind; defaultAmount: number; createdBy: string }) {
  return tx.insert(f).values(row);
}

export function updateFeeType(tx: Tx, id: string, fields: { name?: string; kind?: FeeKind; defaultAmount?: number; active?: boolean }) {
  return tx.update(f).set(fields).where(eq(f.id, id));
}
