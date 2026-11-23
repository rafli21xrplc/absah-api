import { schema, type Tx } from '@absah/db';
import { and, asc, eq, gt, isNull, sql } from 'drizzle-orm';

const k = schema.kioskDevices;
const p = schema.kioskPairings;

export async function insertPairing(tx: Tx, values: { schoolId: string; secretHash: string; expiresAt: Date; createdBy: string }) {
  await tx.insert(p).values(values);
}

/** An unused, unexpired pairing with this secret, locked for the claim. */
export async function lockOpenPairing(tx: Tx, secretHash: string, now: Date) {
  const [row] = await tx
    .select({ id: p.id })
    .from(p)
    .where(and(eq(p.secretHash, secretHash), isNull(p.usedAt), gt(p.expiresAt, now)))
    .for('update');
  return row;
}

export async function usePairing(tx: Tx, id: string, kioskDeviceId: string, at: Date) {
  await tx.update(p).set({ usedAt: at, kioskDeviceId }).where(eq(p.id, id));
}

export async function insertKiosk(tx: Tx, values: { id: string; schoolId: string; name: string; tokenHash: string; appVersion: string | null; createdBy: string | null }) {
  await tx.insert(k).values(values);
}

export async function findKiosk(tx: Tx, id: string) {
  const [row] = await tx.select().from(k).where(eq(k.id, id));
  return row;
}

export const listKiosks = (tx: Tx) => tx.select().from(k).orderBy(asc(k.revokedAt), asc(k.name));

export async function revokeKiosk(tx: Tx, id: string, at: Date): Promise<boolean> {
  const rows = await tx.update(k).set({ revokedAt: at }).where(and(eq(k.id, id), isNull(k.revokedAt))).returning({ id: k.id });
  return rows.length > 0;
}

export async function recordHeartbeat(tx: Tx, id: string, values: { queueSize: number; appVersion: string | null }) {
  await tx
    .update(k)
    .set({ lastSeenAt: sql`now()`, lastQueueSize: values.queueSize, ...(values.appVersion ? { appVersion: values.appVersion } : {}) })
    .where(eq(k.id, id));
}

export async function schoolOf(tx: Tx, schoolId: string) {
  const s = schema.schools;
  const [row] = await tx.select({ id: s.id, name: s.name, level: s.level, isMadrasah: s.isMadrasah, timezone: s.timezone }).from(s).where(eq(s.id, schoolId));
  return row;
}
