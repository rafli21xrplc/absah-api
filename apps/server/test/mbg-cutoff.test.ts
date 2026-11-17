import type { MbgDaily } from '@absah/contracts';
import { schema, sensitive } from '@absah/db';
import { and, asc, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findSchool, generateForSchool } from '../src/modules/attendance';
import { notifyConsumers } from '../src/modules/notify';
import { countCutoffForSchool, countDueCutoffs } from '../src/modules/report';
import { getDb, withPlatform, withTenant } from '../src/shared/db';
import { FakeMessageSender } from '../src/shared/messaging';
import { runConsumer, type Consumer } from '../src/shared/outbox';
import { schoolDate } from '../src/shared/school-date';
import { buildTestApp, enableTotp, signIn, testPhone, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

// A Monday. 08.30 WITA (UTC+8) = 00:30 UTC, 08.30 WIB (UTC+7) = 01:30 UTC.
const DAY = '2027-02-01';
const at = (utc: string) => new Date(`${DAY}T${utc}:00Z`);

interface Fixture {
  id: string;
  classId: string;
  unrecorded: string;
  pic: string;
}
const fx: Record<'wib' | 'wita' | 'off', Fixture> = { wib: blank(), wita: blank(), off: blank() };
function blank(): Fixture {
  return { id: '', classId: '', unrecorded: '', pic: '' };
}

/**
 * One rombel 1A: two students present (H), one with an approved izin (applied by the session
 * generator, as in production) and one nobody has recorded yet.
 */
async function setupSchool(name: string, timezone: string, opts: { mbg: boolean; cutoff: string; date: string }): Promise<Fixture> {
  const id = await t.school('sd', name);
  await getDb().db.update(schema.schools).set({ timezone }).where(eq(schema.schools.id, id));
  if (opts.mbg) await getDb().db.insert(schema.schoolCapabilities).values({ schoolId: id, key: 'mbg.enabled', value: true });
  const pic = testPhone();
  const ctx = await withTenant({ schoolId: id, userId: null }, async (tx) => {
    await tx.insert(schema.mbgSettings).values({ schoolId: id, cutoffTime: opts.cutoff, picName: 'PIC SPPG', picPhone: sensitive(pic) });
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: id, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: id, academicYearId: year?.id ?? '', name: '1A', grade: 1 }).returning();
    const enrollments: string[] = [];
    for (const n of ['SATU', 'DUA', 'TIGA', 'EMPAT']) {
      const [s] = await tx.insert(schema.students).values({ schoolId: id, name: `SISWA ${n}` }).returning();
      const [e] = await tx
        .insert(schema.enrollments)
        .values({ schoolId: id, studentId: s?.id ?? '', classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' })
        .returning();
      enrollments.push(e?.id ?? '');
    }
    await tx.insert(schema.leaveRequests).values({ schoolId: id, enrollmentId: enrollments[2] ?? '', kind: 'izin', startsOn: opts.date, endsOn: opts.date, reason: sensitive('Acara keluarga'), status: 'approved' });
    return { classId: cls?.id ?? '', enrollments };
  });
  const row = await withPlatform((tx) => findSchool(tx, id));
  if (!row) throw new Error('no school');
  await generateForSchool(row, opts.date, new Date(), { force: true });
  await withTenant({ schoolId: id, userId: null }, (tx) =>
    tx.insert(schema.dailyAttendance).values(ctx.enrollments.slice(0, 2).map((enrollmentId) => ({ schoolId: id, enrollmentId, schoolDate: opts.date, status: 'H' as const }))),
  );
  return { id, classId: ctx.classId, unrecorded: ctx.enrollments[3] ?? '', pic };
}

const schoolRow = async (f: Fixture) => {
  const row = await withPlatform((tx) => findSchool(tx, f.id));
  if (!row) throw new Error('no school');
  return row;
};
const countRows = (f: Fixture) =>
  withTenant({ schoolId: f.id, userId: null }, (tx) => tx.select().from(schema.mbgDailyCounts).orderBy(asc(schema.mbgDailyCounts.createdAt)));
const readyEvents = (f: Fixture) =>
  getDb()
    .db.select()
    .from(schema.outboxEvents)
    .where(and(eq(schema.outboxEvents.schoolId, f.id), eq(schema.outboxEvents.type, 'mbg.count_ready')))
    .orderBy(asc(schema.outboxEvents.createdAt));

beforeAll(async () => {
  fx.wib = await setupSchool('SD MBG WIB', 'Asia/Jakarta', { mbg: true, cutoff: '08:30', date: DAY });
  fx.wita = await setupSchool('SD MBG WITA', 'Asia/Makassar', { mbg: true, cutoff: '08:30', date: DAY });
  fx.off = await setupSchool('SD Tanpa MBG', 'Asia/Jakarta', { mbg: false, cutoff: '08:30', date: DAY });
});

describe('rkp.mbg-cutoff', () => {
  it('counts 08.30 WITA and 08.30 WIB at different UTC times, once each', async () => {
    const [wib, wita, off] = await Promise.all([schoolRow(fx.wib), schoolRow(fx.wita), schoolRow(fx.off)]);
    expect(await countCutoffForSchool(wita, at('00:25'))).toBeNull();

    // 00:30 UTC: 08.30 in Makassar, 07.30 in Jakarta. Through the job entry point.
    await countDueCutoffs(at('00:30'));
    expect(await countRows(fx.wita)).toHaveLength(1);
    expect(await countRows(fx.wib)).toHaveLength(0);

    expect(await countCutoffForSchool(wib, at('01:25'))).toBeNull();
    expect(await countCutoffForSchool(wib, at('01:30'))).toEqual({ schoolDate: DAY, classes: 1 });
    // Later runs never count the day again.
    expect(await countCutoffForSchool(wita, at('01:30'))).toBeNull();
    expect(await countCutoffForSchool(wib, at('02:00'))).toBeNull();

    for (const f of [fx.wib, fx.wita]) {
      const rows = await countRows(f);
      expect(rows).toHaveLength(1);
      // 4 enrolled: 2 present, 1 izin (not counted), 1 not recorded yet.
      expect(rows[0]).toMatchObject({ classId: f.classId, schoolDate: DAY, enrolled: 4, presentAtCutoff: 2, unrecorded: 1, supersedesId: null });
      expect(rows[0]?.sentAt).not.toBeNull();
      expect((await readyEvents(f)).map((e) => e.payload)).toEqual([{ schoolDate: DAY, correction: false }]);
    }
    expect((await countRows(fx.wita))[0]?.createdAt.getTime()).toBeLessThan((await countRows(fx.wib))[0]?.createdAt.getTime() ?? 0);

    // mbg.enabled off: nothing counted, nothing sent.
    expect(await countCutoffForSchool(off, at('03:00'))).toBeNull();
    expect(await countRows(fx.off)).toHaveLength(0);
  });

  it('skips a day without sessions (holiday or not generated yet)', async () => {
    const wita = await schoolRow(fx.wita);
    expect(await countCutoffForSchool(wita, new Date('2027-02-02T03:00:00Z'))).toBeNull();
  });

  it('sends the PIC one short message with the total and each rombel', async () => {
    const sender = new FakeMessageSender();
    const consumers = new Map<string, Consumer>(notifyConsumers({ sender, appUrl: 'https://absah.test', now: () => at('00:30') }).map((c) => [c.name, c]));
    const run = (name: string, data: unknown) => {
      const consumer = consumers.get(name);
      if (!consumer) throw new Error(`no consumer ${name}`);
      return runConsumer(consumer, data);
    };
    const [event] = await readyEvents(fx.wita);
    const envelope = { id: event?.id, schoolId: fx.wita.id, type: 'mbg.count_ready', payload: event?.payload, traceId: null, occurredAt: new Date().toISOString() };
    expect(await run('notify_mbg_count', envelope)).toBe('handled');
    expect(await run('notify_mbg_count', envelope)).toBe('duplicate');

    const [n] = await withTenant({ schoolId: fx.wita.id, userId: null }, (tx) => tx.select().from(schema.notifications));
    expect(n).toMatchObject({ templateCode: 'mbg_count', guardianId: null, enrollmentId: null });
    expect(n?.toPhone.reveal()).toBe(fx.wita.pic);
    await run('notify_send', { id: uuidv7(), schoolId: fx.wita.id, type: 'notification.queued', payload: { notificationId: n?.id }, traceId: null, occurredAt: new Date().toISOString() });
    expect(sender.messages.map((m) => [m.to, m.text])).toEqual([
      [fx.wita.pic, 'SD MBG WITA: jumlah siswa hadir untuk MBG Senin, 1 Februari 2027 = 2 siswa. Per rombel: 1A 2 (1 belum diisi).'],
    ]);
  });
});

describe('POST /mbg/daily/recount', () => {
  let school: Fixture;
  let admin: Agent;
  let wakasek: Agent;
  const today = schoolDate('Asia/Jakarta');
  const recount = (agent: Agent, key = uuidv7()) => agent.post('/api/v1/mbg/daily/recount').set('X-School-Id', school.id).set('Idempotency-Key', key).send();

  beforeAll(async () => {
    // Cutoff 00:00 so the count is due whenever the test runs.
    school = await setupSchool('SD MBG Koreksi', 'Asia/Jakarta', { mbg: true, cutoff: '00:00', date: today });
    const [a, k] = await Promise.all([t.staff('Admin Koreksi'), t.staff('Wakasek Koreksi')]);
    await t.member(school.id, a.id, 'admin');
    await t.member(school.id, k.id, 'wakasek');
    [admin, wakasek] = [t.agent(), t.agent()];
    await signIn(admin, a.email).expect(200);
    await enableTotp(admin);
    await signIn(wakasek, k.email).expect(200);
  });

  it('waits for the cutoff count', async () => {
    const res = await recount(admin).expect(409);
    expect((res.body as { details: { reason: string } }).details.reason).toBe('not_counted');
    expect(await countCutoffForSchool(await schoolRow(school), new Date())).toEqual({ schoolDate: today, classes: 1 });
  });

  it('writes nothing when nothing changed', async () => {
    const daily = (await recount(admin).expect(200)).body as MbgDaily;
    expect(daily).toMatchObject({ status: 'counted', total: { present: 2, unrecorded: 1 } });
    expect(await countRows(school)).toHaveLength(1);
  });

  it('adds a row superseding the sent one, keeps the sent row, and tells the PIC', async () => {
    await withTenant({ schoolId: school.id, userId: null }, (tx) => tx.insert(schema.dailyAttendance).values({ schoolId: school.id, enrollmentId: school.unrecorded, schoolDate: today, status: 'T' }));
    const key = uuidv7();
    const daily = (await recount(admin, key).expect(200)).body as MbgDaily;
    expect(daily.classes).toEqual([{ classId: school.classId, name: '1A', enrolled: 4, present: 3, unrecorded: 0, corrected: true }]);
    const replay = await recount(admin, key).expect(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');

    const [sent, fix] = await countRows(school);
    expect(sent).toMatchObject({ presentAtCutoff: 2, unrecorded: 1, supersedesId: null });
    expect(fix).toMatchObject({ presentAtCutoff: 3, unrecorded: 0, supersedesId: sent?.id });
    expect((await readyEvents(school)).map((e) => e.payload)).toEqual([
      { schoolDate: today, correction: false },
      { schoolDate: today, correction: true },
    ]);
    const audits = await getDb()
      .db.select({ action: schema.auditLogs.action })
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.schoolId, school.id), eq(schema.auditLogs.action, 'mbg.recounted')));
    expect(audits).toHaveLength(1);
  });

  it('is for the admin only, and hidden without mbg.enabled', async () => {
    await recount(wakasek).expect(403);
    await getDb()
      .db.update(schema.schoolCapabilities)
      .set({ value: false })
      .where(and(eq(schema.schoolCapabilities.schoolId, school.id), eq(schema.schoolCapabilities.key, 'mbg.enabled')));
    const res = await recount(admin).expect(404);
    expect((res.body as { code: string }).code).toBe('CAPABILITY_DISABLED');
  });
});
