import type { AttendanceStatus, MbgDaily, MbgSettings } from '@absah/contracts';
import { schema } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, testPhone, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let admin: Agent;
let wakasek: Agent;
let guru: Agent;
const ids = { classA: '', classB: '', admin: '' };
const DAY = '2027-01-11';
const HOLIDAY = '2027-01-12';
const bodyOf = <T>(res: { body: unknown }) => res.body as T;
const get = (agent: Agent, path: string) => agent.get(`/api/v1${path}`).set('X-School-Id', school);
const put = (agent: Agent, body: object, key = uuidv7()) => agent.put('/api/v1/mbg/settings').set('X-School-Id', school).set('Idempotency-Key', key).send(body);

async function setMbg(value: boolean) {
  await getDb().db.insert(schema.schoolCapabilities).values({ schoolId: school, key: 'mbg.enabled', value }).onConflictDoUpdate({
    target: [schema.schoolCapabilities.schoolId, schema.schoolCapabilities.key],
    set: { value },
  });
}

beforeAll(async () => {
  school = await t.school('sd', 'SD MBG');
  const [a, k, g] = await Promise.all([t.staff('Admin MBG'), t.staff('Wakasek MBG'), t.staff('Guru MBG')]);
  ids.admin = a.id;
  await t.member(school, a.id, 'admin');
  await t.member(school, k.id, 'wakasek');
  await t.member(school, g.id, 'guru');
  [admin, wakasek, guru] = [t.agent(), t.agent(), t.agent()];
  await signIn(admin, a.email).expect(200);
  await enableTotp(admin);
  await signIn(wakasek, k.email).expect(200);
  await signIn(guru, g.email).expect(200);

  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const academicYearId = year?.id ?? '';
    const [a1, b1] = await tx
      .insert(schema.classes)
      .values([
        { schoolId: school, academicYearId, name: '1A', grade: 1 },
        { schoolId: school, academicYearId, name: '1B', grade: 1 },
      ])
      .returning();
    ids.classA = a1?.id ?? '';
    ids.classB = b1?.id ?? '';
    // 1A: H, T, S (izin sakit), I (izin), A, and one not recorded yet; 1B: H, H. One student left before DAY.
    const students: [string, AttendanceStatus | null, string | null][] = [
      [ids.classA, 'H', null],
      [ids.classA, 'T', null],
      [ids.classA, 'S', null],
      [ids.classA, 'I', null],
      [ids.classA, 'A', null],
      [ids.classA, null, null],
      [ids.classB, 'H', null],
      [ids.classB, 'H', null],
      [ids.classB, 'H', '2027-01-08'],
    ];
    for (const [i, [classId, status, endsOn]] of students.entries()) {
      const [s] = await tx.insert(schema.students).values({ schoolId: school, name: `SISWA MBG ${i}` }).returning();
      const [e] = await tx
        .insert(schema.enrollments)
        .values({ schoolId: school, studentId: s?.id ?? '', classId, academicYearId, startsOn: '2026-07-13', endsOn, status: endsOn ? 'left' : 'active' })
        .returning();
      if (status) await tx.insert(schema.dailyAttendance).values({ schoolId: school, enrollmentId: e?.id ?? '', schoolDate: DAY, status });
    }
    await tx.insert(schema.attendanceDays).values([
      { schoolId: school, schoolDate: DAY, generatedAt: new Date(`${DAY}T00:00:00Z`) },
      { schoolId: school, schoolDate: HOLIDAY, skippedReason: 'holiday' },
    ]);
  });
});

describe('capability (mbg.enabled)', () => {
  it('hides every MBG route while off', async () => {
    for (const path of ['/mbg/daily', '/mbg/settings']) {
      const res = await get(admin, path).expect(404);
      expect(bodyOf<{ code: string }>(res).code).toBe('CAPABILITY_DISABLED');
    }
    await put(admin, { cutoffTime: '08:30', picName: null, picPhone: null }).expect(404);
    await setMbg(true);
  });
});

describe('settings', () => {
  it('starts at 08.30 without a PIC', async () => {
    const res = await get(wakasek, '/mbg/settings').expect(200);
    expect(bodyOf<MbgSettings>(res)).toEqual({ cutoffTime: '08:30', picName: null, picPhone: null, updatedAt: null });
  });

  it('lets the admin set the cutoff and PIC; the number comes back masked and stays out of the audit log', async () => {
    const phone = testPhone();
    const key = uuidv7();
    const body = { cutoffTime: '07:45', picName: 'Bu Sari (SPPG)', picPhone: phone };
    const res = await put(admin, body, key).expect(200);
    expect(bodyOf<MbgSettings>(res)).toMatchObject({ cutoffTime: '07:45', picName: 'Bu Sari (SPPG)', picPhone: `${phone.slice(0, 6)}****${phone.slice(-4)}` });
    const replay = await put(admin, body, key).expect(200);
    expect(replay.headers['idempotent-replayed']).toBe('true');

    const [stored] = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.mbgSettings));
    expect(stored?.picPhone?.reveal()).toBe(phone);
    const audits = await getDb()
      .db.select({ before: schema.auditLogs.before, after: schema.auditLogs.after })
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.schoolId, school), eq(schema.auditLogs.action, 'mbg.settings_updated')));
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0])).not.toContain(phone.slice(-8));
  });

  it('keeps the stored number when picPhone is left out', async () => {
    const res = await put(admin, { cutoffTime: '07:45', picName: 'Bu Sari' }).expect(200);
    expect(bodyOf<MbgSettings>(res).picPhone).toMatch(/^\+628\d{2}\*{4}\d{4}$/);
  });

  it('rejects a bad time or number', async () => {
    await put(admin, { cutoffTime: '25:00', picName: null, picPhone: null }).expect(400);
    await put(admin, { cutoffTime: '08:30', picName: 'X', picPhone: '08123' }).expect(400);
  });

  it('is changed by the admin only and read by school leaders', async () => {
    await put(wakasek, { cutoffTime: '08:30', picName: null, picPhone: null }).expect(403);
    await get(guru, '/mbg/settings').expect(403);
    await get(guru, '/mbg/daily').expect(403);
  });
});

describe('GET /mbg/daily', () => {
  it('counts H and T live before the cutoff; izin, sakit and alpa are not counted', async () => {
    const res = await get(wakasek, `/mbg/daily?date=${DAY}`).expect(200);
    const daily = bodyOf<MbgDaily>(res);
    expect(daily).toMatchObject({ date: DAY, status: 'pending', cutoffTime: '07:45', countedAt: null });
    expect(daily.classes).toEqual([
      { classId: ids.classA, name: '1A', enrolled: 6, present: 2, unrecorded: 1, corrected: false },
      { classId: ids.classB, name: '1B', enrolled: 2, present: 2, unrecorded: 0, corrected: false },
    ]);
    expect(daily.total).toEqual({ enrolled: 8, present: 4, unrecorded: 1 });
  });

  it('says when the day is not a school day', async () => {
    const res = await get(admin, `/mbg/daily?date=${HOLIDAY}`).expect(200);
    expect(bodyOf<MbgDaily>(res)).toMatchObject({ status: 'not_school_day', classes: [] });
  });

  it('after the cutoff shows the stored numbers, with the latest correction per rombel', async () => {
    const date = '2027-01-13';
    const sentAt = new Date(`${date}T00:46:00Z`);
    await withTenant({ schoolId: school, userId: null }, async (tx) => {
      const [a] = await tx
        .insert(schema.mbgDailyCounts)
        .values([
          { schoolId: school, classId: ids.classA, schoolDate: date, enrolled: 6, presentAtCutoff: 3, unrecorded: 3, sentAt },
          { schoolId: school, classId: ids.classB, schoolDate: date, enrolled: 2, presentAtCutoff: 2, unrecorded: 0, sentAt },
        ])
        .returning();
      const [fix] = await tx
        .insert(schema.mbgDailyCounts)
        .values({ schoolId: school, classId: ids.classA, schoolDate: date, enrolled: 6, presentAtCutoff: 4, unrecorded: 1, supersedesId: a?.id, createdBy: ids.admin })
        .returning();
      await tx.insert(schema.mbgDailyCounts).values({ schoolId: school, classId: ids.classA, schoolDate: date, enrolled: 6, presentAtCutoff: 5, unrecorded: 0, supersedesId: fix?.id, createdBy: ids.admin });
    });
    const daily = bodyOf<MbgDaily>(await get(admin, `/mbg/daily?date=${date}`).expect(200));
    expect(daily).toMatchObject({ status: 'counted', sentAt: sentAt.toISOString(), total: { enrolled: 8, present: 7, unrecorded: 0 } });
    expect(daily.classes.map((c) => [c.name, c.present, c.corrected])).toEqual([
      ['1A', 5, true],
      ['1B', 2, false],
    ]);
  });
});

describe('mbg_daily_counts rows', () => {
  it('cannot be changed or deleted by the app role', async () => {
    const tenant = { schoolId: school, userId: null };
    await expect(withTenant(tenant, (tx) => tx.update(schema.mbgDailyCounts).set({ presentAtCutoff: 99 }))).rejects.toThrow();
    await expect(withTenant(tenant, (tx) => tx.delete(schema.mbgDailyCounts))).rejects.toThrow();
  });

  it('allow one cutoff row per rombel and day', async () => {
    const row = { schoolId: school, classId: ids.classB, schoolDate: '2027-01-14', enrolled: 2, presentAtCutoff: 2, unrecorded: 0 };
    await withTenant({ schoolId: school, userId: null }, (tx) => tx.insert(schema.mbgDailyCounts).values(row));
    await expect(withTenant({ schoolId: school, userId: null }, (tx) => tx.insert(schema.mbgDailyCounts).values(row))).rejects.toThrow();
  });
});
