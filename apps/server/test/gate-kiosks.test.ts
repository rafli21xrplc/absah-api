import { deviceDayKey, fromBase64Url, makeCardToken, schoolDayKey, toBase64Url, verifyCardToken } from '@absah/contracts';
import { schema } from '@absah/db';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { schoolDate } from '../src/shared/school-date';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let admin: Agent;
let parent: Agent;
let guru: Agent;
let school: string;
let studentId: string;
const key = () => `gerbang-${uuidv7()}`;
const today = schoolDate('Asia/Jakarta');

const as = (agent: Agent, method: 'get' | 'post', path: string) => {
  const r = agent[method](`/api/v1${path}`).set('X-School-Id', school);
  return method === 'post' ? r.set('Idempotency-Key', key()) : r;
};
const kiosk = () => request(t.app);
const pair = (pairingCode: string, k = key()) => kiosk().post('/api/v1/kiosk/pair').set('Idempotency-Key', k).send({ pairingCode, name: 'Gerbang depan', appVersion: '1.0.0' });
const beat = (token: string, queueSize = 0, k = key()) =>
  kiosk().post('/api/v1/kiosk/heartbeat').set('Authorization', `Kiosk ${token}`).set('Idempotency-Key', k).send({ queueSize });

async function setCap(capKey: string, value: unknown) {
  await getDb().db.insert(schema.schoolCapabilities).values({ schoolId: school, key: capKey, value }).onConflictDoUpdate({
    target: [schema.schoolCapabilities.schoolId, schema.schoolCapabilities.key],
    set: { value },
  });
}

beforeAll(async () => {
  school = await t.school('smp', 'SMP Kios');
  const a = await t.staff('Admin Kios');
  const p = await t.staff('Ibu Sari');
  const g = await t.staff('Guru Kios');
  await t.member(school, a.id, 'admin');
  await t.member(school, p.id, 'orang_tua');
  await t.member(school, g.id, 'guru');
  admin = t.agent();
  await signIn(admin, a.email).expect(200);
  await enableTotp(admin);
  parent = t.agent();
  await signIn(parent, p.email).expect(200);
  guru = t.agent();
  await signIn(guru, g.email).expect(200);

  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: '8C', grade: 8 }).returning();
    const [student] = await tx.insert(schema.students).values({ schoolId: school, name: 'DIMAS' }).returning();
    studentId = student?.id ?? '';
    await tx.insert(schema.enrollments).values({ schoolId: school, studentId, classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' });
    const [guardian] = await tx.insert(schema.guardians).values({ schoolId: school, name: 'Sari', userId: p.id }).returning();
    await tx.insert(schema.studentGuardians).values({ schoolId: school, studentId, guardianId: guardian?.id ?? '', relation: 'ibu', isPrimary: true });
  });
});

describe('kiosk devices (GRB-02)', () => {
  it('are hidden while gate.enabled is off', async () => {
    const res = await as(admin, 'get', '/gate/kiosks').expect(404);
    expect((res.body as { code: string }).code).toBe('CAPABILITY_DISABLED');
    await setCap('gate.enabled', true);
  });

  it('pair with a one-time code, send heartbeats, and stop working once revoked', async () => {
    await as(guru, 'post', '/gate/kiosks/pairings').expect(403);
    const { pairingCode } = (await as(admin, 'post', '/gate/kiosks/pairings').expect(200)).body as { pairingCode: string };
    expect(pairingCode.startsWith(`${school}.`)).toBe(true);

    const pairKey = key();
    const paired = await pair(pairingCode, pairKey).expect(200);
    const { deviceToken, kiosk: device } = paired.body as { deviceToken: string; kiosk: { id: string } };
    // A lost response can be retried with the same key; the code itself works only once.
    expect(((await pair(pairingCode, pairKey).expect(200)).body as { deviceToken: string }).deviceToken).toBe(deviceToken);
    await pair(pairingCode).expect(404);
    await pair(`${uuidv7()}.${'x'.repeat(43)}`).expect(404);

    await beat(deviceToken, 3).expect(200);
    const heartbeatKey = key();
    await beat(deviceToken, 0, heartbeatKey).expect(200);
    expect((await beat(deviceToken, 0, heartbeatKey).expect(200)).headers['idempotent-replayed']).toBe('true');
    const list = (await as(admin, 'get', '/gate/kiosks').expect(200)).body as { items: { id: string; online: boolean; lastQueueSize: number; appVersion: string }[] };
    expect(list.items).toEqual([expect.objectContaining({ id: device.id, online: true, lastQueueSize: 0, appVersion: '1.0.0' })]);

    const forged = deviceToken.replace(/\.[^.]+$/, `.${'y'.repeat(43)}`);
    await beat(forged).expect(401);
    await kiosk().post('/api/v1/kiosk/heartbeat').set('Idempotency-Key', key()).send({ queueSize: 0 }).expect(401);

    await as(admin, 'post', `/gate/kiosks/${device.id}/revoke`).expect(200);
    await beat(deviceToken).expect(401);
  });
});

describe('kiosk CORS', () => {
  it('lets only the kiosk origin call /kiosk/* cross-origin, without cookies', async () => {
    const pre = await kiosk().options('/api/v1/kiosk/scans').set('Origin', 'http://kios.test').set('Access-Control-Request-Method', 'POST').expect(204);
    expect(pre.headers['access-control-allow-origin']).toBe('http://kios.test');
    expect(pre.headers['access-control-allow-headers']).toContain('Idempotency-Key');
    expect(pre.headers['access-control-allow-credentials']).toBeUndefined();
    const other = await kiosk().options('/api/v1/kiosk/scans').set('Origin', 'https://jahat.test').set('Access-Control-Request-Method', 'POST');
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
    const web = await kiosk().get('/api/v1/health').set('Origin', 'http://kios.test');
    expect(web.headers['access-control-allow-origin']).toBeUndefined();
  });
});

describe('cards on the holder phone (GRB-01)', () => {
  it('bind to a parent phone; only the latest phone gets keys', async () => {
    await setCap('card.holder', 'parent');
    const mine = (await as(parent, 'get', '/cards/mine').expect(200)).body as { holder: string; items: { studentId: string; hasDevice: boolean }[] };
    expect(mine).toEqual({ holder: 'parent', items: [expect.objectContaining({ studentId, hasDevice: false })] });
    await as(guru, 'post', '/cards/devices').send({ studentId }).expect(404);

    const first = (await as(parent, 'post', '/cards/devices').send({ studentId, label: 'HP Ibu' }).expect(200)).body as {
      cardId: string;
      deviceId: string;
      keys: { schoolDate: string; key: string }[];
    };
    expect(first.keys.map((k) => k.schoolDate)[0]).toBe(today);
    expect(first.keys).toHaveLength(7);

    // The kiosk's day key verifies tokens the phone makes with its device key.
    const [row] = await getDb().db.select({ secret: schema.gateSecrets.secret }).from(schema.gateSecrets).where(eq(schema.gateSecrets.schoolId, school));
    const dayKey = await schoolDayKey(fromBase64Url(row?.secret.reveal() ?? ''), today);
    expect(first.keys[0]?.key).toBe(toBase64Url(await deviceDayKey(dayKey, first.deviceId)));
    const now = Date.now();
    const token = await makeCardToken({ cardId: first.cardId, deviceId: first.deviceId, deviceKey: fromBase64Url(first.keys[0]?.key ?? ''), ms: now });
    expect(await verifyCardToken(token, now, 'Asia/Jakarta', (d) => (d === today ? dayKey : null))).toMatchObject({ ok: true, cardId: first.cardId });

    await as(parent, 'get', `/cards/devices/${first.deviceId}/keys`).expect(200);
    const second = (await as(parent, 'post', '/cards/devices').send({ studentId, label: 'HP baru' }).expect(200)).body as { cardId: string; deviceId: string };
    expect(second.cardId).toBe(first.cardId);
    await as(parent, 'get', `/cards/devices/${first.deviceId}/keys`).expect(404);
    await as(guru, 'get', `/cards/devices/${second.deviceId}/keys`).expect(404);
  });
});
