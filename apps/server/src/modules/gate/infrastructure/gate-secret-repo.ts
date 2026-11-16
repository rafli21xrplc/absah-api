import { randomBytes } from 'node:crypto';
import { fromBase64Url, schoolDayKey } from '@absah/contracts';
import { schema, sensitive, type Tx } from '@absah/db';

/** The school's card secret, created on first use. */
export async function schoolSecret(tx: Tx, schoolId: string): Promise<Uint8Array> {
  await tx
    .insert(schema.gateSecrets)
    .values({ schoolId, secret: sensitive(randomBytes(32).toString('base64url')) })
    .onConflictDoNothing();
  const [row] = await tx.select({ secret: schema.gateSecrets.secret }).from(schema.gateSecrets);
  if (!row) throw new Error('gate secret missing');
  return fromBase64Url(row.secret.reveal());
}

export async function dayKeys(tx: Tx, schoolId: string, dates: string[]): Promise<Map<string, Uint8Array>> {
  const secret = await schoolSecret(tx, schoolId);
  return new Map(await Promise.all(dates.map(async (d) => [d, await schoolDayKey(secret, d)] as const)));
}
