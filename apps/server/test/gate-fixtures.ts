import { randomBytes } from 'node:crypto';
import { deviceDayKey, fromBase64Url, makeCardToken, schoolDayKey } from '@absah/contracts';
import { schema } from '@absah/db';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { hashValue } from '../src/shared/crypto';
import { getDb, withTenant } from '../src/shared/db';
import type { buildTestApp } from './harness';

type TestApp = ReturnType<typeof buildTestApp>;

/** gate.enabled on, plus a kiosk device created directly (pairing has its own test). */
export async function gateSchool(t: TestApp, schoolId: string, name = 'Gerbang uji') {
  await getDb().db.insert(schema.schoolCapabilities).values({ schoolId, key: 'gate.enabled', value: true }).onConflictDoNothing();
  return addKiosk(t, schoolId, name);
}

export async function addKiosk(t: TestApp, schoolId: string, name: string) {
  const id = uuidv7();
  const secret = randomBytes(32).toString('base64url');
  await withTenant({ schoolId, userId: null }, (tx) => tx.insert(schema.kioskDevices).values({ id, schoolId, name, tokenHash: hashValue(secret) }));
  const token = `${schoolId}.${id}.${secret}`;
  return {
    id,
    post: (path: string, body: object, key = `kios-${uuidv7()}`) =>
      request(t.app).post(`/api/v1${path}`).set('Authorization', `Kiosk ${token}`).set('Idempotency-Key', key).send(body),
    get: (path: string) => request(t.app).get(`/api/v1${path}`).set('Authorization', `Kiosk ${token}`),
  };
}

/** Binds a card to a fresh device for each student (as if the holder activated it). */
export async function bindCards(schoolId: string, studentIds: string[]): Promise<Map<string, { cardId: string; deviceId: string }>> {
  return withTenant({ schoolId, userId: null }, async (tx) => {
    const out = new Map<string, { cardId: string; deviceId: string }>();
    for (const studentId of studentIds) {
      const cardId = uuidv7();
      const deviceId = uuidv7();
      await tx.insert(schema.cards).values({ id: cardId, schoolId, studentId, activeDeviceId: deviceId });
      await tx.insert(schema.cardDevices).values({ id: deviceId, schoolId, cardId, holder: 'student' });
      out.set(studentId, { cardId, deviceId });
    }
    return out;
  });
}

/** Makes tokens like the holder's phone does, from the school secret (created on first kiosk call). */
export async function tokenMaker(schoolId: string) {
  const [row] = await getDb().db.select({ secret: schema.gateSecrets.secret }).from(schema.gateSecrets).where(eq(schema.gateSecrets.schoolId, schoolId));
  if (!row) throw new Error('no gate secret yet: call GET /kiosk/day first');
  const secret = fromBase64Url(row.secret.reveal());
  return async (card: { cardId: string; deviceId: string }, date: string, ms: number) =>
    makeCardToken({ ...card, deviceKey: await deviceDayKey(await schoolDayKey(secret, date), card.deviceId), ms });
}
