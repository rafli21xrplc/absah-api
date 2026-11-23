import { schema, type Tx } from '@absah/db';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

const p = schema.examPeriods;
const columns = {
  id: p.id,
  name: p.name,
  academicYearId: p.academicYearId,
  academicYearName: schema.academicYears.name,
  startsOn: p.startsOn,
  endsOn: p.endsOn,
  minAttendance: p.minAttendance,
  attendanceFrom: p.attendanceFrom,
  excusedCounts: p.excusedCounts,
  requirePaid: p.requirePaid,
  feeTypeIds: p.feeTypeIds,
  closedAt: p.closedAt,
};
export type ExamPeriodRow = Awaited<ReturnType<typeof findPeriod>> & {};

const joined = (tx: Tx) => tx.select(columns).from(p).innerJoin(schema.academicYears, eq(schema.academicYears.id, p.academicYearId));

/** Newest first; closed ones only when asked. */
export function listPeriods(tx: Tx, includeClosed: boolean) {
  const query = joined(tx);
  return (includeClosed ? query : query.where(isNull(p.closedAt))).orderBy(desc(p.startsOn), desc(p.id));
}

export async function findPeriod(tx: Tx, id: string) {
  const [row] = await joined(tx).where(eq(p.id, id));
  return row;
}

export async function activeYearId(tx: Tx): Promise<string | undefined> {
  const [row] = await tx.select({ id: schema.academicYears.id }).from(schema.academicYears).where(eq(schema.academicYears.isActive, true));
  return row?.id;
}

/** How many of these fee type ids exist in the school. */
export async function countFeeTypes(tx: Tx, ids: string[]): Promise<number> {
  if (ids.length === 0) return 0;
  const rows = await tx.select({ id: schema.feeTypes.id }).from(schema.feeTypes).where(and(inArray(schema.feeTypes.id, ids)));
  return rows.length;
}

export function insertPeriod(tx: Tx, row: typeof p.$inferInsert) {
  return tx.insert(p).values(row);
}

export function updatePeriod(tx: Tx, id: string, fields: Partial<Pick<typeof p.$inferInsert, 'name' | 'startsOn' | 'endsOn' | 'minAttendance' | 'attendanceFrom' | 'excusedCounts' | 'requirePaid' | 'feeTypeIds' | 'closedAt'>>) {
  return tx.update(p).set(fields).where(eq(p.id, id));
}
