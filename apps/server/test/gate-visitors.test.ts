import { schema } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '../src/shared/db';
import { purgeVisitorPhotos } from '../src/modules/gate';
import { schoolDate } from '../src/shared/school-date';
import { storageKey } from '../src/shared/storage';
import { gateSchool } from './gate-fixtures';
import { buildTestApp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

type Kiosk = Awaited<ReturnType<typeof gateSchool>>;
type Visit = { id: string; hasPhoto: boolean; name: string; organization: string | null; host: { id: string; name: string } | null; leftAt: string | null; schoolDate: string };
type VisitList = { schoolDate: string; inside: number; items: Visit[] };

const today = schoolDate('Asia/Jakarta');
let school: string;
let kiosk: Kiosk;
let piket: Agent;
let guru: Agent;
let kepsek: Agent;
let guruId: string;
let offSchool: string;
let offKiosk: Kiosk;

const signInGuest = (body: object, key?: string) => kiosk.post('/kiosk/visitors', body, key);
const guest = (over: object = {}) => ({ clientEventId: uuidv7(), name: 'Pak Hendra', organization: 'Dinas Pendidikan', purpose: 'Monitoring BOS', ...over });
const list = (agent: Agent, query = '') => agent.get(`/api/v1/visitors${query}`).set('X-School-Id', school);
const leave = (agent: Agent, id: string, key = `tamu-${uuidv7()}`) =>
  agent.patch(`/api/v1/visitors/${id}/leave`).set('X-School-Id', school).set('Idempotency-Key', key);
const arrivedEvents = () =>
  getDb()
    .db.select({ payload: schema.outboxEvents.payload })
    .from(schema.outboxEvents)
    .where(and(eq(schema.outboxEvents.schoolId, school), eq(schema.outboxEvents.type, 'gate.visitor_arrived')));

beforeAll(async () => {
  school = await t.school('sma', 'SMA Buku Tamu');
  kiosk = await gateSchool(t, school);
  const p = await t.staff('Pak Piket Tamu');
  const g = await t.staff('Bu Guru Tuan Rumah');
  const o = await t.staff('Kepsek Tamu');
  guruId = g.id;
  await t.member(school, p.id, 'piket');
  await t.member(school, g.id, 'guru');
  await t.member(school, o.id, 'kepsek');
  piket = t.agent();
  await signIn(piket, p.email).expect(200);
  guru = t.agent();
  await signIn(guru, g.email).expect(200);
  kepsek = t.agent();
  await signIn(kepsek, o.email).expect(200);

  offSchool = await t.school('sma', 'SMA Tanpa Buku Tamu');
  offKiosk = await gateSchool(t, offSchool);
  await getDb().db.insert(schema.schoolCapabilities).values({ schoolId: offSchool, key: 'gate.visitors', value: false });
});

describe('POST /kiosk/visitors (GRB-11)', () => {
  it('records a guest, names the host and emits gate.visitor_arrived once', async () => {
    const body = guest({ hostUserId: guruId });
    const res = await signInGuest(body).expect(200);
    expect(res.body).toMatchObject({ name: 'Pak Hendra', organization: 'Dinas Pendidikan', purpose: 'Monitoring BOS', schoolDate: today, leftAt: null, host: { id: guruId, name: 'Bu Guru Tuan Rumah' } });
    const events = await arrivedEvents();
    expect(events).toHaveLength(1);
    expect(events[0]?.payload).toEqual({ visitorId: (res.body as Visit).id, hostUserId: guruId });
  });

  it('records a resend (same clientEventId, even with a new Idempotency-Key) once', async () => {
    const body = guest({ hostUserId: guruId, name: 'Ibu Sari' });
    const first = await signInGuest(body).expect(200);
    const again = await signInGuest(body).expect(200);
    expect((again.body as Visit).id).toBe((first.body as Visit).id);
    const all = await list(piket, '?status=all').expect(200);
    expect((all.body as VisitList).items.filter((v) => v.name === 'Ibu Sari')).toHaveLength(1);
    expect((await arrivedEvents()).filter((e) => (e.payload as { visitorId: string }).visitorId === (first.body as Visit).id)).toHaveLength(1);
  });

  it('replays the same Idempotency-Key with the stored answer', async () => {
    const key = `kios-${uuidv7()}`;
    const body = guest({ name: 'Tamu Replay' });
    const first = await signInGuest(body, key).expect(200);
    const replay = await signInGuest(body, key).expect(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
  });

  it('needs no host and stores no organization when left blank', async () => {
    const res = await signInGuest(guest({ name: 'Kurir Paket', organization: '  ', purpose: 'Antar paket' })).expect(200);
    expect(res.body).toMatchObject({ host: null, organization: null });
    expect((await arrivedEvents()).some((e) => (e.payload as { visitorId: string }).visitorId === (res.body as Visit).id)).toBe(false);
  });

  it('rejects a missing name or purpose, a too long text, unknown fields and a host who is not staff', async () => {
    await signInGuest(guest({ name: '   ' })).expect(400);
    await signInGuest(guest({ purpose: '' })).expect(400);
    await signInGuest(guest({ purpose: 'x'.repeat(201) })).expect(400);
    await signInGuest({ ...guest(), extra: true }).expect(400);
    const res = await signInGuest(guest({ hostUserId: uuidv7() })).expect(400);
    expect(JSON.stringify(res.body)).toContain('hostUserId');
  });

  it('needs a paired kiosk and gate.visitors', async () => {
    await t.agent().post('/api/v1/kiosk/visitors').set('Idempotency-Key', key()).send(guest()).expect(401);
    const res = await offKiosk.post('/kiosk/visitors', guest()).expect(404);
    expect(res.body).toMatchObject({ code: 'CAPABILITY_DISABLED' });
    await offKiosk.get('/kiosk/visitor-hosts').expect(404);
  });
});

function key() {
  return `tamu-${uuidv7()}`;
}

describe('GET /kiosk/visitor-hosts', () => {
  it('lists active staff by name, never parents or students', async () => {
    const res = await kiosk.get('/kiosk/visitor-hosts').expect(200);
    const names = (res.body as { items: { name: string }[] }).items.map((i) => i.name);
    expect(names).toEqual(expect.arrayContaining(['Bu Guru Tuan Rumah', 'Pak Piket Tamu']));
    expect(Object.keys((res.body as { items: object[] }).items[0] ?? {}).sort()).toEqual(['id', 'name']);
  });
});

describe('piket: list and sign out', () => {
  let visitId: string;

  it('shows the day, newest first, with the number still inside', async () => {
    const made = await signInGuest(guest({ name: 'Tamu Terbaru' })).expect(200);
    visitId = (made.body as Visit).id;
    const res = await list(piket).expect(200);
    const body = res.body as VisitList;
    expect(body.schoolDate).toBe(today);
    expect(body.items[0]?.id).toBe(visitId);
    expect(body.inside).toBe(body.items.filter((v) => !v.leftAt).length);
    expect(body.inside).toBeGreaterThan(0);
  });

  it('signs a guest out, audits it, and signing out again changes nothing', async () => {
    const first = await leave(piket, visitId).expect(200);
    const leftAt = (first.body as Visit).leftAt;
    expect(leftAt).not.toBeNull();
    const again = await leave(piket, visitId).expect(200);
    expect((again.body as Visit).leftAt).toBe(leftAt);
    const audits = await getDb()
      .db.select({ id: schema.auditLogs.id })
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.schoolId, school), eq(schema.auditLogs.action, 'gate.visitor_left'), eq(schema.auditLogs.entityId, visitId)));
    expect(audits).toHaveLength(1);
    const inside = await list(piket, '?status=inside').expect(200);
    expect((inside.body as VisitList).items.some((v) => v.id === visitId)).toBe(false);
  });

  it('replays an idempotent sign-out', async () => {
    const made = await signInGuest(guest({ name: 'Tamu Idempoten' })).expect(200);
    const id = (made.body as Visit).id;
    const replayKey = key();
    const first = await leave(piket, id, replayKey).expect(200);
    const replay = await leave(piket, id, replayKey).expect(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
  });

  it('answers 404 for an unknown guest and 400 for a bad date', async () => {
    await leave(piket, uuidv7()).expect(404);
    await list(piket, '?date=kemarin').expect(400);
    const empty = await list(piket, '?date=2020-01-01').expect(200);
    expect(empty.body).toMatchObject({ inside: 0, items: [] });
  });

  it('is for piket and managers: a plain guru is refused, the kepsek may only read', async () => {
    await list(guru).expect(403);
    await leave(guru, visitId).expect(403);
    await list(kepsek).expect(200);
    await leave(kepsek, visitId).expect(403);
  });

  it('answers 404 when gate.visitors is off, and keeps schools apart', async () => {
    await getDb().db.insert(schema.schoolCapabilities).values({ schoolId: school, key: 'gate.visitors', value: false }).onConflictDoUpdate({
      target: [schema.schoolCapabilities.schoolId, schema.schoolCapabilities.key],
      set: { value: false },
    });
    const res = await list(piket).expect(404);
    expect(res.body).toMatchObject({ code: 'CAPABILITY_DISABLED' });
    await getDb().db.update(schema.schoolCapabilities).set({ value: true }).where(and(eq(schema.schoolCapabilities.schoolId, school), eq(schema.schoolCapabilities.key, 'gate.visitors')));
  });
});

describe('guest photo', () => {
  const putPhoto = async (agent: Agent, upload: { url: string; headers: Record<string, string> }, bytes = 'JPEG!') => {
    const url = new URL(upload.url);
    await agent.put(url.pathname + url.search).set(upload.headers).send(Buffer.from(bytes)).expect(200);
  };
  const newPhoto = async () => (await kiosk.post('/kiosk/visitor-photos', { fileSize: 5, contentType: 'image/jpeg' }).expect(200)).body as { photoId: string; upload: { url: string; headers: Record<string, string> } };
  const photoLink = (agent: Agent, id: string) => agent.get(`/api/v1/visitors/${id}/photo`).set('X-School-Id', school);
  const photoRow = async (id: string) => {
    const [row] = await getDb().db.select({ key: schema.visitors.photoKey, removedAt: schema.visitors.photoRemovedAt }).from(schema.visitors).where(eq(schema.visitors.id, id));
    return row;
  };

  it('refuses a photo that was never uploaded, then keeps the uploaded one private behind a short link', async () => {
    const photo = await newPhoto();
    const early = await signInGuest(guest({ photoId: photo.photoId })).expect(400);
    expect(JSON.stringify(early.body)).toContain('photoId');
    await putPhoto(t.agent(), photo.upload);
    const made = (await signInGuest(guest({ name: 'Tamu Berfoto', photoId: photo.photoId })).expect(200)).body as Visit;
    expect(made.hasPhoto).toBe(true);

    await photoLink(guru, made.id).expect(403);
    const link = (await photoLink(piket, made.id).expect(200)).body as { url: string };
    const url = new URL(link.url);
    const file = await t.agent().get(url.pathname + url.search).expect(200);
    expect(file.headers['content-type']).toBe('image/jpeg');
    expect(Buffer.from(file.body as Buffer).toString()).toBe('JPEG!');
    const views = await getDb()
      .db.select({ id: schema.auditLogs.id })
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.schoolId, school), eq(schema.auditLogs.action, 'gate.visitor_photo_viewed'), eq(schema.auditLogs.entityId, made.id)));
    expect(views).toHaveLength(1);
  });

  it('answers 404 for a guest without a photo, and refuses another type, a big file or an unknown photoId', async () => {
    const plain = (await signInGuest(guest({ name: 'Tanpa Foto' })).expect(200)).body as Visit;
    expect(plain.hasPhoto).toBe(false);
    await photoLink(piket, plain.id).expect(404);
    await kiosk.post('/kiosk/visitor-photos', { fileSize: 5, contentType: 'image/png' }).expect(400);
    await kiosk.post('/kiosk/visitor-photos', { fileSize: 2 * 1024 * 1024 + 1, contentType: 'image/jpeg' }).expect(400);
    await signInGuest(guest({ photoId: uuidv7() })).expect(400);
    await offKiosk.post('/kiosk/visitor-photos', { fileSize: 5, contentType: 'image/jpeg' }).expect(404);
  });

  it('replays an idempotent photo request with the same upload', async () => {
    const k = key();
    const first = await kiosk.post('/kiosk/visitor-photos', { fileSize: 5, contentType: 'image/jpeg' }, k).expect(200);
    const replay = await kiosk.post('/kiosk/visitor-photos', { fileSize: 5, contentType: 'image/jpeg' }, k).expect(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');
    expect(replay.body).toEqual(first.body);
  });

  it('removes photos 30 days after the guest left, or after arrival when nobody signed them out', async () => {
    const signed = async (name: string) => {
      const photo = await newPhoto();
      await putPhoto(t.agent(), photo.upload);
      const v = (await signInGuest(guest({ name, photoId: photo.photoId })).expect(200)).body as Visit;
      return { id: v.id, key: storageKey(school, 'visitors', photo.photoId) };
    };
    const left = await signed('Sudah Pulang');
    const stayed = await signed('Lupa Absen Pulang');
    await leave(piket, left.id).expect(200);

    const day = 86_400_000;
    await purgeVisitorPhotos(t.storage, new Date(Date.now() + 29 * day));
    expect((await photoRow(left.id))?.removedAt).toBeNull();
    expect(await t.storage.read(left.key)).not.toBeNull();

    await purgeVisitorPhotos(t.storage, new Date(Date.now() + 31 * day));
    for (const visit of [left, stayed]) {
      expect((await photoRow(visit.id))?.removedAt).not.toBeNull();
      expect(await t.storage.read(visit.key)).toBeNull();
      await photoLink(piket, visit.id).expect(404);
    }
    const shown = await list(piket).expect(200);
    expect((shown.body as VisitList).items.find((v) => v.id === left.id)?.hasPhoto).toBe(false);
  });
});
