import { schema, type Tx } from '@absah/db';
import { and, desc, eq, lt } from 'drizzle-orm';

const w = schema.workspaceExports;
const columns = {
  id: w.id,
  status: w.status,
  includeFiles: w.includeFiles,
  includeTppk: w.includeTppk,
  fileKey: w.fileKey,
  fileName: w.fileName,
  sizeBytes: w.sizeBytes,
  tableCount: w.tableCount,
  fileCount: w.fileCount,
  error: w.error,
  requestedBy: w.requestedBy,
  createdAt: w.createdAt,
  finishedAt: w.finishedAt,
};
export type WorkspaceExportRow = NonNullable<Awaited<ReturnType<typeof findExport>>>;

export const listExports = (tx: Tx) => tx.select(columns).from(w).orderBy(desc(w.createdAt), desc(w.id)).limit(50);

export async function findExport(tx: Tx, id: string, lock = false) {
  const query = tx.select(columns).from(w).where(eq(w.id, id));
  const [row] = await (lock ? query.for('update') : query);
  return row;
}

export async function insertExport(tx: Tx, values: { id: string; schoolId: string; includeFiles: boolean; includeTppk: boolean; fileKey: string; requestedBy: string }) {
  await tx.insert(w).values(values);
}

export function finishExport(tx: Tx, id: string, fields: { status: 'done' | 'failed' | 'expired'; fileName?: string; sizeBytes?: number; tableCount?: number; fileCount?: number; error?: string }) {
  return tx.update(w).set({ ...fields, finishedAt: new Date() }).where(eq(w.id, id));
}

/** Whether the user is on the school's TPPK team: the only people whose export may hold the tppk schema. */
export async function isTppkMember(tx: Tx, userId: string): Promise<boolean> {
  const [row] = await tx.select({ id: schema.tppkMembers.id }).from(schema.tppkMembers).where(eq(schema.tppkMembers.userId, userId));
  return Boolean(row);
}

/** Finished exports older than the cutoff, marked expired (their files are removed by the caller). */
export function expireExports(tx: Tx, cutoff: Date) {
  return tx.update(w).set({ status: 'expired' }).where(and(eq(w.status, 'done'), lt(w.finishedAt, cutoff))).returning({ id: w.id, fileKey: w.fileKey });
}
