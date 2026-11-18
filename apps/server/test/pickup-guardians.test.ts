import type { PickupGuardian, PickupGuardianList } from '@absah/contracts';
import { schema } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { purgePickupPhotos } from '../src/modules/gate';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, testPhone, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let parent: Agent;
let wali: Agent;
let otherWali: Agent;
let admin: Agent;
let piket: Agent;
let stranger: Agent;
let ani: string;
let budi: string;

const bodyOf = <T>(res: { body: unknown }) => res.body as T;
const post = (agent: Agent, path: string, body: object = {}, key = uuidv7()) => agent.post(`/api/v1${path}`).set('X-School-Id', school).set('Idempotency-Key', key).send(body);
const get = (agent: Agent, path: string) => agent.get(`/api/v1${path}`).set('X-School-Id', school);

async function otpLogin(phoneNumber: string) {
  const agent = t.agent();
  await agent.post('/api/auth/phone-number/send-otp').send({ phoneNumber }).expect(200);
  await agent.post('/api/auth/phone-number/verify').send({ phoneNumber, code: t.messageSender.lastCodeFor(phoneNumber) }).expect(200);
  return agent;
}

/** Asks for an upload, PUTs the JPEG, returns the photoId. */
async function photo(agent: Agent, studentId: string) {
  const res = bodyOf<{ photoId: string; upload: { url: string; headers: Record<string, string> } }>(await post(agent, '/pickup-guardian-photos', { studentId, fileSize: 5, contentType: 'image/jpeg' }).expect(200));
  const url = new URL(res.upload.url);
  await t.agent().put(url.pathname + url.search).set(res.upload.headers).send(Buffer.from('JPEG!')).expect(200);
  return res.photoId;
}

const entry = (photoId: string, over: object = {}) => ({ name: 'Pak Darto', relation: 'sopir', phone: testPhone(), photoId, ...over });

beforeAll(async () => {
  school = await t.school('sd', 'SD Penjemput');
  const [w, w2, a, p, s] = await Promise.all([t.staff('Bu Wali 1A'), t.staff('Pak Wali 1B'), t.staff('Admin Jemput'), t.staff('Pak Piket Jemput'), t.staff('Guru Lain')]);
  await t.member(school, w.id, 'guru');
  await t.member(school, w2.id, 'guru');
  await t.member(school, a.id, 'admin');
  await t.member(school, p.id, 'piket');
  await t.member(school, s.id, 'guru');
  const parentUser = await t.parent(testPhone(), 'Ibu Ani');
  await t.member(school, parentUser.id, 'orang_tua');
  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [c1, c2] = await tx
      .insert(schema.classes)
      .values([
        { schoolId: school, academicYearId: year?.id ?? '', name: '1A', grade: 1, homeroomTeacherId: w.id },
        { schoolId: school, academicYearId: year?.id ?? '', name: '1B', grade: 1, homeroomTeacherId: w2.id },
      ])
      .returning();
    const [sa, sb] = await tx.insert(schema.students).values([{ schoolId: school, name: 'ANI LESTARI' }, { schoolId: school, name: 'BUDI SANTOSO' }]).returning();
    ani = sa?.id ?? '';
    budi = sb?.id ?? '';
    await tx.insert(schema.enrollments).values([
      { schoolId: school, studentId: ani, classId: c1?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' },
      { schoolId: school, studentId: budi, classId: c2?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' },
    ]);
    const [g] = await tx.insert(schema.guardians).values({ schoolId: school, name: 'Ibu Ani', userId: parentUser.id }).returning();
    await tx.insert(schema.studentGuardians).values({ schoolId: school, studentId: ani, guardianId: g?.id ?? '', relation: 'ibu', isPrimary: true });
  });
  parent = await otpLogin(parentUser.phoneNumber);
  wali = t.agent();
  await signIn(wali, w.email).expect(200);
  otherWali = t.agent();
  await signIn(otherWali, w2.email).expect(200);
  admin = t.agent();
  await signIn(admin, a.email).expect(200);
  await enableTotp(admin);
  piket = t.agent();
  await signIn(piket, p.email).expect(200);
  stranger = t.agent();
  await signIn(stranger, s.email).expect(200);
});

describe('penjemput resmi (GRB-09)', () => {
  it('lets a parent register (pending) and the wali kelas approve', async () => {
    const phone = testPhone();
    const made = bodyOf<PickupGuardian>(await post(parent, `/students/${ani}/pickup-guardians`, entry(await photo(parent, ani), { phone })).expect(201));
    expect(made).toMatchObject({ studentId: ani, studentName: 'ANI LESTARI', className: '1A', name: 'Pak Darto', relation: 'sopir', status: 'pending', hasPhoto: true, decidedAt: null });
    expect(made.phone).toBe(`${phone.slice(0, 6)}****${phone.slice(-4)}`);

    // The number is encrypted at rest and never in the audit log.
    const [row] = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.pickupGuardians).where(eq(schema.pickupGuardians.id, made.id)));
    expect(row?.phone.reveal()).toBe(phone);
    const logs = await getDb().db.select().from(schema.auditLogs).where(and(eq(schema.auditLogs.schoolId, school), eq(schema.auditLogs.entityId, made.id)));
    expect(logs.map((l) => l.action)).toEqual(['gate.pickup_guardian_registered']);
    expect(JSON.stringify(logs)).not.toContain(phone.slice(-8));

    // The queue: the wali kelas of 1A sees it, the wali kelas of 1B does not; the admin sees all.
    const queue = (agent: Agent) => get(agent, '/pickup-guardians?status=pending').expect(200).then((r) => bodyOf<PickupGuardianList>(r).items.map((i) => i.id));
    expect(await queue(wali)).toEqual([made.id]);
    expect(await queue(otherWali)).toEqual([]);
    expect(await queue(admin)).toEqual([made.id]);

    // Only the wali kelas or admin decides; the parent cannot approve their own entry.
    await post(parent, `/pickup-guardians/${made.id}/approve`).expect(404);
    await post(otherWali, `/pickup-guardians/${made.id}/approve`).expect(404);
    const approved = bodyOf<PickupGuardian>(await post(wali, `/pickup-guardians/${made.id}/approve`).expect(200));
    expect(approved.status).toBe('approved');
    expect(approved.decidedAt).not.toBeNull();
    // Repeating is a no-op; rejecting an approved entry is a conflict.
    await post(wali, `/pickup-guardians/${made.id}/approve`).expect(200);
    await post(admin, `/pickup-guardians/${made.id}/reject`).expect(409);
    expect(bodyOf<PickupGuardianList>(await get(parent, `/students/${ani}/pickup-guardians`).expect(200)).items.map((i) => i.status)).toEqual(['approved']);
  });

  it('approves at once what the wali kelas or admin registers', async () => {
    const made = bodyOf<PickupGuardian>(await post(admin, `/students/${budi}/pickup-guardians`, entry(await photo(admin, budi), { name: 'Kakek Budi', relation: 'kakek' })).expect(201));
    expect(made.status).toBe('approved');
  });

  it('hides the student from anyone else, photos from the parent', async () => {
    await get(stranger, `/students/${ani}/pickup-guardians`).expect(404);
    await post(stranger, '/pickup-guardian-photos', { studentId: ani, fileSize: 5, contentType: 'image/jpeg' }).expect(404);
    await post(parent, `/students/${budi}/pickup-guardians`, entry(uuidv7())).expect(404);
    await post(parent, `/students/${ani}/pickup-guardians`, entry(uuidv7())).expect(400); // never uploaded
    // Piket reads the list (no decisions) and opens photos; the parent does not.
    const list = bodyOf<PickupGuardianList>(await get(piket, `/students/${ani}/pickup-guardians`).expect(200));
    const id = list.items[0]?.id ?? '';
    await post(piket, `/pickup-guardians/${id}/deactivate`).expect(404);
    await get(parent, `/pickup-guardians/${id}/photo`).expect(404);
    await get(otherWali, `/pickup-guardians/${id}/photo`).expect(404);
    expect(bodyOf<{ url: string }>(await get(piket, `/pickup-guardians/${id}/photo`).expect(200)).url).toContain('/storage/');
    await get(wali, `/pickup-guardians/${id}/photo`).expect(200);
    const viewed = await getDb().db.$count(schema.auditLogs, and(eq(schema.auditLogs.schoolId, school), eq(schema.auditLogs.action, 'gate.pickup_photo_viewed')));
    expect(viewed).toBe(2);
  });

  it('caps open entries per student and lets the parent deactivate', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push(bodyOf<PickupGuardian>(await post(parent, `/students/${ani}/pickup-guardians`, entry(await photo(parent, ani), { name: `Penjemput ${i}` })).expect(201)).id);
    const res = await post(parent, `/students/${ani}/pickup-guardians`, entry(await photo(parent, ani))).expect(409);
    expect(bodyOf<{ details: unknown }>(res).details).toEqual({ reason: 'too_many' });
    expect(bodyOf<PickupGuardian>(await post(parent, `/pickup-guardians/${ids[0]}/deactivate`).expect(200)).status).toBe('inactive');
    await post(wali, `/pickup-guardians/${ids[0]}/approve`).expect(409);
    expect(bodyOf<PickupGuardian>(await post(wali, `/pickup-guardians/${ids[1]}/reject`).expect(200)).status).toBe('rejected');
    await post(parent, `/students/${ani}/pickup-guardians`, entry(await photo(parent, ani))).expect(201);
  });

  it('removes photos 30 days after an entry ended', async () => {
    const made = bodyOf<PickupGuardian>(await post(wali, `/students/${ani}/pickup-guardians`, entry(await photo(wali, ani), { name: 'Supir Lama' })).expect(201));
    await post(wali, `/pickup-guardians/${made.id}/deactivate`).expect(200);
    const [row] = await getDb().db.select({ key: schema.pickupGuardians.photoKey }).from(schema.pickupGuardians).where(eq(schema.pickupGuardians.id, made.id));
    const day = 86_400_000;
    await purgePickupPhotos(t.storage, new Date(Date.now() + 29 * day));
    expect(await t.storage.read(row?.key ?? '')).not.toBeNull();
    await purgePickupPhotos(t.storage, new Date(Date.now() + 31 * day));
    expect(await t.storage.read(row?.key ?? '')).toBeNull();
    await get(wali, `/pickup-guardians/${made.id}/photo`).expect(404);
    const list = bodyOf<PickupGuardianList>(await get(wali, `/students/${ani}/pickup-guardians`).expect(200));
    expect(list.items.find((i) => i.id === made.id)?.hasPhoto).toBe(false);
  });

  it('is off without gate.pickup', async () => {
    const smp = await t.school('smp', 'SMP Tanpa Jemput');
    const a = await t.staff('Admin SMP Jemput');
    await t.member(smp, a.id, 'admin');
    const agent = t.agent();
    await signIn(agent, a.email).expect(200);
    await enableTotp(agent);
    await agent.get('/api/v1/pickup-guardians').set('X-School-Id', smp).expect(404);
  });
});
