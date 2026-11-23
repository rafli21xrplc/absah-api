import type { MbgForecast } from '@absah/contracts';
import { schema, sensitive } from '@absah/db';
import { and, asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findSchool } from '../src/modules/attendance';
import { notifyConsumers } from '../src/modules/notify';
import { forecastForSchool } from '../src/modules/report';
import { getDb, withPlatform, withTenant } from '../src/shared/db';
import { FakeMessageSender } from '../src/shared/messaging';
import { runConsumer, type Consumer } from '../src/shared/outbox';
import { buildTestApp, enableTotp, signIn, testPhone, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

// Tuesday 2 February 2027, WIB (UTC+7): 13.00 WIB = 06:00 UTC. Target: Friday 5 February.
const wib = (date: string, hhmm: string) => new Date(`${date}T${hhmm}:00+07:00`);
const TARGET = '2027-02-05';
let school: string;
let pic: string;
let admin: Agent;

const row = async () => {
  const r = await withPlatform((tx) => findSchool(tx, school));
  if (!r) throw new Error('no school');
  return r;
};

beforeAll(async () => {
  school = await t.school('sd', 'SD Prakiraan');
  await getDb().db.insert(schema.schoolCapabilities).values({ schoolId: school, key: 'mbg.enabled', value: true });
  pic = testPhone();
  const u = await t.staff('Bu Admin');
  await t.member(school, u.id, 'admin');
  admin = t.agent();
  await signIn(admin, u.email).expect(200);
  await enableTotp(admin);

  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    await tx.insert(schema.mbgSettings).values({ schoolId: school, picName: 'PIC SPPG', picPhone: sensitive(pic) });
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const yearId = year?.id ?? '';
    const [c1a, c1b] = await tx
      .insert(schema.classes)
      .values([
        { schoolId: school, academicYearId: yearId, name: '1A', grade: 1 },
        { schoolId: school, academicYearId: yearId, name: '1B', grade: 1 },
      ])
      .returning();
    const enroll: Record<string, string> = {};
    for (const [name, cls] of [['A', c1a], ['B', c1a], ['C', c1a], ['D', c1a], ['E', c1a], ['F', c1a], ['G', c1b]] as const) {
      const [s] = await tx.insert(schema.students).values({ schoolId: school, name: `SISWA ${name}` }).returning();
      const [e] = await tx.insert(schema.enrollments).values({ schoolId: school, studentId: s?.id ?? '', classId: cls?.id ?? '', academicYearId: yearId, startsOn: '2026-07-13' }).returning();
      enroll[name] = e?.id ?? '';
    }
    const leave = (enrollmentId: string, status: 'approved' | 'pending') =>
      ({ schoolId: school, enrollmentId, kind: 'izin' as const, startsOn: '2027-02-04', endsOn: TARGET, reason: sensitive('Acara keluarga'), status });
    await tx.insert(schema.leaveRequests).values([leave(enroll.A ?? '', 'approved'), leave(enroll.C ?? '', 'approved'), leave(enroll.F ?? '', 'pending')]);
    const [lomba, pramuka, kemah] = await tx
      .insert(schema.activities)
      .values([
        { schoolId: school, academicYearId: yearId, name: 'Lomba Kabupaten', kind: 'lainnya', location: 'luar_sekolah', days: [5] },
        { schoolId: school, academicYearId: yearId, name: 'Pramuka', kind: 'ekskul', location: 'sekolah', days: [5] },
        { schoolId: school, academicYearId: yearId, name: 'Kemah', kind: 'lainnya', location: 'luar_sekolah', days: [], startsOn: '2027-02-04', endsOn: '2027-02-06' },
      ])
      .returning();
    await tx.insert(schema.activityMembers).values([
      { schoolId: school, activityId: lomba?.id ?? '', enrollmentId: enroll.B ?? '' },
      { schoolId: school, activityId: lomba?.id ?? '', enrollmentId: enroll.C ?? '' }, // also on izin: counted once
      { schoolId: school, activityId: pramuka?.id ?? '', enrollmentId: enroll.D ?? '' }, // at school: still eats
      { schoolId: school, activityId: kemah?.id ?? '', enrollmentId: enroll.E ?? '' },
    ]);
  });
});

describe('prakiraan MBG H-3 (RKP-09)', () => {
  it('waits for 13.00 and skips a target that is not a school day', async () => {
    expect(await forecastForSchool(await row(), wib('2027-02-02', '12:55'))).toBeNull();
    expect(await forecastForSchool(await row(), wib('2027-02-04', '13:00'))).toBeNull(); // target Sunday
  });

  it('stores active - approved izin - off-campus activity per rombel once, and tells the PIC', async () => {
    const now = wib('2027-02-02', '13:00');
    expect(await forecastForSchool(await row(), now)).toEqual({ schoolDate: TARGET, classes: 2 });
    expect(await forecastForSchool(await row(), wib('2027-02-02', '13:05'))).toBeNull();

    const rows = await withTenant({ schoolId: school, userId: null }, (tx) =>
      tx.select().from(schema.mbgForecasts).orderBy(asc(schema.mbgForecasts.forecast)),
    );
    expect(rows.map((r) => [r.enrolled, r.onLeave, r.offCampus, r.forecast])).toEqual([
      [1, 0, 0, 1],
      [6, 2, 2, 2],
    ]);
    await expect(withTenant({ schoolId: school, userId: null }, (tx) => tx.update(schema.mbgForecasts).set({ forecast: 99 }))).rejects.toThrow();

    const [event] = await getDb()
      .db.select()
      .from(schema.outboxEvents)
      .where(and(eq(schema.outboxEvents.schoolId, school), eq(schema.outboxEvents.type, 'mbg.forecast_ready')));
    expect(event?.payload).toEqual({ schoolDate: TARGET });
    const consumer = notifyConsumers({ sender: new FakeMessageSender(), appUrl: 'https://absah.test', now: () => now }).find((c) => c.name === 'notify_mbg_forecast') as Consumer;
    await runConsumer(consumer, { id: uuidv7(), schoolId: school, type: 'mbg.forecast_ready', payload: { schoolDate: TARGET }, traceId: null, occurredAt: now.toISOString() });
    const [message] = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.notifications));
    expect(message?.templateCode).toBe('mbg_forecast');
    expect(message?.toPhone.reveal()).toBe(pic);
    expect(JSON.parse(message?.params.reveal() ?? '{}')).toMatchObject({ total: '3', classes: '1A 2, 1B 1' });
  });

  it('shows the forecast on GET /mbg/forecast', async () => {
    const res = await admin.get(`/api/v1/mbg/forecast?date=${TARGET}`).set('X-School-Id', school).expect(200);
    const body = res.body as MbgForecast;
    expect(body).toMatchObject({ date: TARGET, status: 'computed', total: 3 });
    expect(body.classes.map((c) => [c.name, c.forecast])).toEqual([
      ['1A', 2],
      ['1B', 1],
    ]);
    const empty = (await admin.get('/api/v1/mbg/forecast?date=2027-02-08').set('X-School-Id', school).expect(200)).body as MbgForecast;
    expect(empty).toMatchObject({ status: 'pending', total: 0, classes: [] });
  });
});
