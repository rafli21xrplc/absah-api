import type { ActionLinkContext, KioskDay, KioskUnlistedPickup, LinkHeldPickups, PickupEvent, PickupEventList } from '@absah/contracts';
import { schema, sensitive } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import request from 'supertest';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { expireAndPurgeUnlisted } from '../src/modules/gate';
import { notifyConsumers } from '../src/modules/notify';
import { mintActionLink } from '../src/shared/action-links';
import { getDb, withTenant } from '../src/shared/db';
import { FakeMessageSender } from '../src/shared/messaging';
import { runConsumer, type EventType } from '../src/shared/outbox';
import { schoolDate } from '../src/shared/school-date';
import { bindCards, gateSchool, tokenMaker } from './gate-fixtures';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

type Kiosk = Awaited<ReturnType<typeof gateSchool>>;
const today = schoolDate('Asia/Jakarta');
const yesterday = new Date(Date.parse(`${today}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
let school: string;
let kiosk: Kiosk;
let token: Awaited<ReturnType<typeof tokenMaker>>;
let cards: Map<string, { cardId: string; deviceId: string }>;
let linkToken: string;
let wali: Agent;
let admin: Agent;
let piket: Agent;
let guru: Agent;
const ids: Record<string, string> = {};

const bodyOf = <T>(res: { body: unknown }) => res.body as T;
const cardToken = (student: string) => token(cards.get(ids[student] ?? '') ?? { cardId: '', deviceId: '' }, today, Date.now());
const staff = (agent: Agent, method: 'get' | 'post', path: string) => {
  const r = method === 'get' ? agent.get(`/api/v1${path}`) : agent.post(`/api/v1${path}`).set('Idempotency-Key', uuidv7());
  return r.set('X-School-Id', school);
};
const link = (method: 'get' | 'post', path: string) => (method === 'get' ? request(t.app).get(`/api/v1${path}`) : request(t.app).post(`/api/v1${path}`)).set('Authorization', `Link ${linkToken}`);

/** The kiosk takes a photo, uploads it and holds the student. */
async function hold(student: string, name: string, status = 200, clientEventId = uuidv7()) {
  const photo = bodyOf<{ photoId: string; upload: { url: string; headers: Record<string, string> } }>(await kiosk.post('/kiosk/pickup-photos', { fileSize: 5, contentType: 'image/jpeg' }).expect(200));
  const url = new URL(photo.upload.url);
  await t.agent().put(url.pathname + url.search).set(photo.upload.headers).send(Buffer.from('JPEG!')).expect(200);
  const res = await kiosk.post('/kiosk/unlisted-pickups', { clientEventId, token: await cardToken(student), name, photoId: photo.photoId, requestedAt: new Date().toISOString() }).expect(status);
  return res.body as KioskUnlistedPickup & { details?: unknown };
}

beforeAll(async () => {
  school = await t.school('sd', 'SD Jemput Tamu');
  kiosk = await gateSchool(t, school);
  const [w, a, p, g] = await Promise.all([t.staff('Bu Wali 3A'), t.staff('Admin Jemput Tamu'), t.staff('Piket Jemput Tamu'), t.staff('Guru Lain Jemput')]);
  await t.member(school, w.id, 'guru');
  await t.member(school, a.id, 'admin');
  await t.member(school, p.id, 'piket');
  await t.member(school, g.id, 'guru');
  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [c1, c2] = await tx
      .insert(schema.classes)
      .values([
        { schoolId: school, academicYearId: year?.id ?? '', name: '3A', grade: 3, homeroomTeacherId: w.id },
        { schoolId: school, academicYearId: year?.id ?? '', name: '3B', grade: 3 },
      ])
      .returning();
    for (const [name, cls] of [['ANI LESTARI', c1], ['BUDI SANTOSO', c2], ['CICI', c1]] as const) {
      const [s] = await tx.insert(schema.students).values({ schoolId: school, name }).returning();
      const [e] = await tx.insert(schema.enrollments).values({ schoolId: school, studentId: s?.id ?? '', classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' }).returning();
      ids[name] = s?.id ?? '';
      ids[`${name}:enrollment`] = e?.id ?? '';
    }
    const [guardian] = await tx.insert(schema.guardians).values({ schoolId: school, name: 'Ibu Ani', phone: sensitive('+6281200008001'), phoneHash: 'x' }).returning();
    await tx.insert(schema.studentGuardians).values({ schoolId: school, studentId: ids['ANI LESTARI'] ?? '', guardianId: guardian?.id ?? '', relation: 'ibu', isPrimary: true });
    const url = await mintActionLink(tx, { schoolId: school, guardianId: guardian?.id ?? '', studentId: ids['ANI LESTARI'] ?? '', appUrl: 'https://absah.test' });
    linkToken = url.split('#')[1] ?? '';
  });
  cards = await bindCards(school, [ids['ANI LESTARI'] ?? '', ids['BUDI SANTOSO'] ?? '', ids.CICI ?? '']);
  await kiosk.get('/kiosk/day').expect(200);
  token = await tokenMaker(school);
  wali = t.agent();
  await signIn(wali, w.email).expect(200);
  admin = t.agent();
  await signIn(admin, a.email).expect(200);
  await enableTotp(admin);
  piket = t.agent();
  await signIn(piket, p.email).expect(200);
  guru = t.agent();
  await signIn(guru, g.email).expect(200);
});

describe('unlisted penjemput (GRB-10)', () => {
  it('holds the student, asks the parent, and releases on their link', async () => {
    const clientEventId = uuidv7();
    const held = await hold('ANI LESTARI', 'Om Joko', 200, clientEventId);
    expect(held).toMatchObject({ status: 'held', firstName: 'Ani', pickupName: 'Om Joko', decidedVia: null });
    // A resend of the same event returns the same request.
    expect((await hold('ANI LESTARI', 'Om Joko', 200, clientEventId)).id).toBe(held.id);
    const asked = await getDb().db.select().from(schema.outboxEvents).where(and(eq(schema.outboxEvents.schoolId, school), eq(schema.outboxEvents.type, 'gate.unlisted_pickup')));
    expect(asked).toHaveLength(1);

    // The parent gets an unlisted_pickup message with their own link.
    const consumer = notifyConsumers({ sender: new FakeMessageSender(), appUrl: 'https://absah.test' }).find((c) => c.name === 'notify_unlisted_pickup');
    if (!consumer) throw new Error('no consumer');
    await runConsumer(consumer, { id: uuidv7(), schoolId: school, type: 'gate.unlisted_pickup' as EventType, payload: { pickupEventId: held.id }, traceId: null, occurredAt: new Date().toISOString() });
    const queued = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.notifications));
    expect(queued.map((n) => n.templateCode)).toEqual(['unlisted_pickup']);
    expect(JSON.parse(queued[0]?.params.reveal() ?? '{}')).toMatchObject({ first_name: 'Ani', pickup_name: 'Om Joko' });

    // The link page shows the request and its photo; the parent allows.
    const context = bodyOf<ActionLinkContext>(await link('get', '/links/context').expect(200));
    expect(context.pickups.map((p) => [p.id, p.pickupName, p.status])).toEqual([[held.id, 'Om Joko', 'held']]);
    await link('get', `/links/pickups/${held.id}/photo`).expect(200);
    const after = bodyOf<LinkHeldPickups>(await link('post', `/links/pickups/${held.id}`).send({ decision: 'allow' }).expect(200));
    expect(after.pickups[0]?.status).toBe('released');
    await link('post', `/links/pickups/${held.id}`).send({ decision: 'allow' }).expect(200); // same again: no-op
    await link('post', `/links/pickups/${held.id}`).send({ decision: 'deny' }).expect(409);

    const polled = bodyOf<KioskUnlistedPickup>(await kiosk.get(`/kiosk/unlisted-pickups/${held.id}`).expect(200));
    expect(polled).toMatchObject({ status: 'released', decidedVia: 'guardian' });
    const released = await getDb().db.select().from(schema.outboxEvents).where(and(eq(schema.outboxEvents.schoolId, school), eq(schema.outboxEvents.type, 'gate.checked_out')));
    expect(released.map((e) => e.payload)).toEqual([{ pickupEventId: held.id }]);
    const logs = await getDb().db.select({ action: schema.auditLogs.action }).from(schema.auditLogs).where(and(eq(schema.auditLogs.schoolId, school), eq(schema.auditLogs.entityId, held.id)));
    expect(logs.map((l) => l.action).sort()).toEqual(['gate.unlisted_photo_viewed', 'gate.unlisted_pickup_released']);

    // Ani has left: another request for her is refused.
    expect((await hold('ANI LESTARI', 'Tante Rina', 409)).details).toEqual({ reason: 'already_released' });
  });

  it('lets the wali kelas or admin decide on the web, and shows the day to the right people', async () => {
    const cici = await hold('CICI', 'Pak RT');
    const budi = await hold('BUDI SANTOSO', 'Mas Andi');

    // The wali kelas of 3A sees 3A only; piket sees every check-out; held first.
    const day = (agent: Agent) => staff(agent, 'get', '/pickups').expect(200).then((r) => bodyOf<PickupEventList>(r));
    expect((await day(wali)).items.map((i) => [i.studentName, i.status, i.listed])).toEqual([
      ['CICI', 'held', false],
      ['ANI LESTARI', 'released', false],
    ]);
    expect((await day(piket)).items.map((i) => i.studentName)).toEqual(['BUDI SANTOSO', 'CICI', 'ANI LESTARI']);
    expect((await day(guru)).items).toEqual([]);

    // Deciding: the student's wali kelas or the admin; not piket or another teacher.
    await staff(guru, 'post', `/pickups/${cici.id}/deny`).expect(404);
    await staff(piket, 'post', `/pickups/${cici.id}/deny`).expect(404);
    await staff(wali, 'post', `/pickups/${budi.id}/allow`).expect(404);
    expect(bodyOf<PickupEvent>(await staff(wali, 'post', `/pickups/${cici.id}/deny`).expect(200))).toMatchObject({ status: 'denied', decidedVia: 'staff' });
    const allowed = bodyOf<PickupEvent>(await staff(admin, 'post', `/pickups/${budi.id}/allow`).expect(200));
    expect(allowed.status).toBe('released');
    expect(allowed.checkedOutAt).not.toBeNull();
    expect(bodyOf<KioskUnlistedPickup>(await kiosk.get(`/kiosk/unlisted-pickups/${cici.id}`).expect(200)).status).toBe('denied');

    // Photos: wali kelas, piket, admin; audited.
    await staff(guru, 'get', `/pickups/${cici.id}/photo`).expect(404);
    await staff(piket, 'get', `/pickups/${cici.id}/photo`).expect(200);
    // The parent's link only reaches their own child's requests.
    await link('post', `/links/pickups/${cici.id}`).send({ decision: 'allow' }).expect(404);
    await link('get', `/links/pickups/${cici.id}/photo`).expect(404);
  });

  it('expires held requests of past days and removes unlisted photos after 30 days', async () => {
    const id = uuidv7();
    await withTenant({ schoolId: school, userId: null }, (tx) =>
      tx.insert(schema.pickupEvents).values({ id, schoolId: school, schoolDate: yesterday, clientEventId: uuidv7(), studentId: ids.CICI ?? '', enrollmentId: ids['CICI:enrollment'] ?? '', pickupName: 'Kemarin', unlistedPhotoKey: `schools/${school}/pickup/${uuidv7()}`, status: 'held' }),
    );
    const result = await expireAndPurgeUnlisted(t.storage);
    expect(result.expired).toBeGreaterThanOrEqual(1);
    const [row] = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.pickupEvents).where(eq(schema.pickupEvents.id, id)));
    expect(row?.status).toBe('expired');
    await staff(wali, 'post', `/pickups/${id}/allow`).expect(409);

    const later = await expireAndPurgeUnlisted(t.storage, new Date(Date.now() + 31 * 86_400_000));
    expect(later.removed).toBeGreaterThanOrEqual(4);
    expect(bodyOf<PickupEventList>(await staff(piket, 'get', '/pickups').expect(200)).items.every((i) => !i.hasPhoto)).toBe(true);
  });

  it('keeps the kiosk kit and routes off without gate.pickup', async () => {
    const smp = await t.school('smp', 'SMP Tanpa Jemput Tamu');
    const other = await gateSchool(t, smp);
    expect(bodyOf<KioskDay>(await other.get('/kiosk/day').expect(200)).pickup).toBeNull();
    await other.post('/kiosk/pickup-photos', { fileSize: 5, contentType: 'image/jpeg' }).expect(404);
    await other.get(`/kiosk/unlisted-pickups/${uuidv7()}`).expect(404);
  });
});
