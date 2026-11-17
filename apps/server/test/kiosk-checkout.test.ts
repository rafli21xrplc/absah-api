import type { KioskCheckoutResults, KioskDay } from '@absah/contracts';
import { schema, sensitive } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { notifyConsumers } from '../src/modules/notify';
import { getDb, withTenant } from '../src/shared/db';
import { FakeMessageSender } from '../src/shared/messaging';
import { runConsumer, type EventType } from '../src/shared/outbox';
import { schoolDate } from '../src/shared/school-date';
import { storageKey } from '../src/shared/storage';
import { bindCards, gateSchool, tokenMaker } from './gate-fixtures';
import { buildTestApp } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

type Kiosk = Awaited<ReturnType<typeof gateSchool>>;
const today = schoolDate('Asia/Jakarta');
let school: string;
let kiosk: Kiosk;
let token: Awaited<ReturnType<typeof tokenMaker>>;
let cards: Map<string, { cardId: string; deviceId: string }>;
const ids: Record<string, string> = {};

const checkout = (pickupGuardianId: string, tok: string, over: object = {}) => ({ clientEventId: uuidv7(), token: tok, pickupGuardianId, checkedOutAt: new Date().toISOString(), ...over });
const send = async (items: object[], key?: string) => (await kiosk.post('/kiosk/checkouts', { checkouts: items }, key).expect(200)).body as KioskCheckoutResults;
const cardToken = (student: string) => token(cards.get(ids[student] ?? '') ?? { cardId: '', deviceId: '' }, today, Date.now());

async function guardian(studentId: string, name: string, status: 'pending' | 'approved' | 'inactive', validUntil: string | null = null) {
  const id = uuidv7();
  const photoKey = storageKey(school, 'pickup', uuidv7());
  await t.storage.write(photoKey, Buffer.from('JPEG!'), 'image/jpeg');
  await withTenant({ schoolId: school, userId: null }, (tx) =>
    tx.insert(schema.pickupGuardians).values({ id, schoolId: school, studentId, name, relation: 'sopir', phone: sensitive('+6281299990000'), photoKey, status, validUntil, decidedAt: status === 'pending' ? null : new Date() }),
  );
  return id;
}

beforeAll(async () => {
  school = await t.school('sd', 'SD Jemput Kios');
  kiosk = await gateSchool(t, school);
  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: '2A', grade: 2 }).returning();
    for (const name of ['ANI LESTARI', 'BUDI SANTOSO', 'CICI']) {
      const [s] = await tx.insert(schema.students).values({ schoolId: school, name }).returning();
      ids[name] = s?.id ?? '';
      await tx.insert(schema.enrollments).values({ schoolId: school, studentId: s?.id ?? '', classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' });
    }
    const [g] = await tx.insert(schema.guardians).values({ schoolId: school, name: 'Ibu Ani', phone: sensitive('+6281200007001'), phoneHash: 'x' }).returning();
    await tx.insert(schema.studentGuardians).values({ schoolId: school, studentId: ids['ANI LESTARI'] ?? '', guardianId: g?.id ?? '', relation: 'ibu', isPrimary: true });
  });
  cards = await bindCards(school, Object.values(ids));
  ids.darto = await guardian(ids['ANI LESTARI'] ?? '', 'Pak Darto', 'approved');
  ids.siti = await guardian(ids['ANI LESTARI'] ?? '', 'Bu Siti', 'pending');
  ids.lama = await guardian(ids['ANI LESTARI'] ?? '', 'Supir Lama', 'approved', '2026-07-31');
  ids.kakek = await guardian(ids['BUDI SANTOSO'] ?? '', 'Kakek Budi', 'approved');
});

describe('kiosk check-out (GRB-10)', () => {
  it('lists approved, still valid penjemput per card with photo links in the morning kit', async () => {
    const day = (await kiosk.get('/kiosk/day').expect(200)).body as KioskDay;
    token = await tokenMaker(school);
    const ani = day.pickup?.find((p) => p.cardId === cards.get(ids['ANI LESTARI'] ?? '')?.cardId);
    expect(ani?.guardians.map((g) => g.name)).toEqual(['Pak Darto']);
    expect(ani?.guardians[0]?.photoUrl).toContain('/storage/');
    expect(day.pickup?.find((p) => p.cardId === cards.get(ids.CICI ?? '')?.cardId)).toBeUndefined();
    // The kiosk can fetch the photo with the link (offline copy).
    const url = new URL(ani?.guardians[0]?.photoUrl ?? '');
    await t.agent().get(url.pathname + url.search).expect(200);
  });

  it('releases a student once per day, exactly once per client event, and tells the parents', async () => {
    const first = checkout(ids.darto ?? '', await cardToken('ANI LESTARI'));
    const key = `kios-${uuidv7()}`;
    const res = await send([first], key);
    expect(res.results).toEqual([{ clientEventId: first.clientEventId, result: 'released', rejectReason: null, firstName: 'Ani' }]);
    expect((await send([first])).results[0]?.result).toBe('released'); // resend, new key
    const again = checkout(ids.darto ?? '', await cardToken('ANI LESTARI'));
    expect((await send([again])).results[0]?.result).toBe('duplicate');

    const events = await getDb().db.select().from(schema.outboxEvents).where(and(eq(schema.outboxEvents.schoolId, school), eq(schema.outboxEvents.type, 'gate.checked_out')));
    expect(events).toHaveLength(1);
    const rows = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.pickupEvents));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: 'released', pickupName: 'Pak Darto', pickupGuardianId: ids.darto, schoolDate: today });

    // notify_checked_out queues student_picked_up for the parent with a phone.
    const sender = new FakeMessageSender();
    const consumer = notifyConsumers({ sender, appUrl: 'https://absah.test' }).find((c) => c.name === 'notify_checked_out');
    const envelope = { id: uuidv7(), schoolId: school, type: 'gate.checked_out' as EventType, payload: { pickupEventId: rows[0]?.id }, traceId: null, occurredAt: new Date().toISOString() };
    if (!consumer) throw new Error('no consumer');
    expect(await runConsumer(consumer, envelope)).toBe('handled');
    const queued = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.notifications));
    expect(queued.map((n) => n.templateCode)).toEqual(['student_picked_up']);
    expect(JSON.parse(queued[0]?.params.reveal() ?? '{}')).toMatchObject({ first_name: 'Ani', pickup_name: 'Pak Darto' });
  });

  it("refuses a penjemput who is not an approved one of this student, and bad cards", async () => {
    const res = await send([
      checkout(ids.siti ?? '', await cardToken('BUDI SANTOSO')), // pending, and of another student
      checkout(ids.kakek ?? '', await cardToken('CICI')), // another student's
      checkout(ids.lama ?? '', await cardToken('BUDI SANTOSO')),
      checkout(ids.kakek ?? '', 'not-a-token'),
    ]);
    expect(res.results.map((r) => [r.result, r.rejectReason])).toEqual([
      ['rejected', 'not_authorized'],
      ['rejected', 'not_authorized'],
      ['rejected', 'not_authorized'],
      ['rejected', 'malformed'],
    ]);
  });

  it('accepts a penjemput deactivated after the morning sync', async () => {
    await withTenant({ schoolId: school, userId: null }, (tx) => tx.update(schema.pickupGuardians).set({ status: 'inactive', endedAt: new Date() }).where(eq(schema.pickupGuardians.id, ids.kakek ?? '')));
    const res = await send([checkout(ids.kakek ?? '', await cardToken('BUDI SANTOSO'))]);
    expect(res.results[0]).toMatchObject({ result: 'released', firstName: 'Budi' });
  });

  it('is off without gate.pickup', async () => {
    const smp = await t.school('smp', 'SMP Kios Tanpa Jemput');
    const other = await gateSchool(t, smp);
    expect(((await other.get('/kiosk/day').expect(200)).body as KioskDay).pickup).toBeNull();
    await other.post('/kiosk/checkouts', { checkouts: [checkout(uuidv7(), 'x')] }).expect(404);
  });
});
