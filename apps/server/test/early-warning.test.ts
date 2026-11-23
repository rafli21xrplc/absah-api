import { schema } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { raiseEarlyWarnings } from '../src/modules/student-affairs';
import { getDb, withTenant } from '../src/shared/db';
import { addDays, schoolDate } from '../src/shared/school-date';
import { buildTestApp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

type Warning = { id: string; student: { name: string; className: string }; kind: string; date: string; dates: string[] };

const today = schoolDate('Asia/Jakarta');
// 18.30 and 17.00 WIB today.
const evening = new Date(`${today}T11:30:00Z`);
const afternoon = new Date(`${today}T10:00:00Z`);
const day = (back: number) => addDays(today, -back);

let smp: string; // per jam pelajaran, no PKL
let smk: string; // PKL on, attendance daily
let off: string; // student.early_warning off
let kepsek: Agent;
let guruBk: Agent;
let wali: Agent;
let otherWali: Agent;
let guru: Agent;
let offAdmin: Agent;
const names = (res: { body: unknown }) => (res.body as { items: Warning[] }).items;
const list = (agent: Agent, schoolId: string, query = '') => agent.get(`/api/v1/early-warnings${query}`).set('X-School-Id', schoolId);
const kindsOf = (items: Warning[], student: string) => items.filter((w) => w.student.name === student).map((w) => w.kind).sort();

interface Seed {
  name: string;
  daily: string; // statuses for the last days, oldest first, ending today
  bolos?: number[]; // days back with an A in a jam pelajaran
  pkl?: number[]; // days back with an A on a PKL work day
}

async function seed(schoolId: string, className: string, homeroom: string | null, students: Seed[]) {
  await withTenant({ schoolId, userId: null }, async (tx) => {
    const [existing] = await tx.select({ id: schema.academicYears.id }).from(schema.academicYears).limit(1);
    const year = existing ?? (await tx.insert(schema.academicYears).values({ schoolId, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning())[0];
    const [cls] = await tx.insert(schema.classes).values({ schoolId, academicYearId: year?.id ?? '', name: className, grade: 8, homeroomTeacherId: homeroom }).returning();
    const sessions = new Map<string, string>();
    const session = async (date: string, mode: 'per_period' | 'pkl') => {
      const k = `${mode}:${date}`;
      let id = sessions.get(k);
      if (!id) {
        id = uuidv7();
        await tx.insert(schema.attendanceSessions).values({ id, schoolId, schoolDate: date, mode, ownerType: mode === 'pkl' ? 'placement' : 'class', ownerId: uuidv7(), status: 'submitted' });
        sessions.set(k, id);
      }
      return id;
    };
    for (const s of students) {
      const [student] = await tx.insert(schema.students).values({ schoolId, name: s.name }).returning();
      const [e] = await tx.insert(schema.enrollments).values({ schoolId, studentId: student?.id ?? '', classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' }).returning();
      const enrollmentId = e?.id ?? '';
      const statuses = [...s.daily];
      await tx.insert(schema.dailyAttendance).values(statuses.map((status, i) => ({ schoolId, enrollmentId, schoolDate: day(statuses.length - 1 - i), status: status as 'H' })));
      for (const back of s.bolos ?? []) await tx.insert(schema.attendanceRecords).values({ schoolId, sessionId: await session(day(back), 'per_period'), enrollmentId, status: 'A', source: 'teacher' });
      for (const back of s.pkl ?? []) await tx.insert(schema.attendanceRecords).values({ schoolId, sessionId: await session(day(back), 'pkl'), enrollmentId, status: 'A', source: 'pkl_confirm' });
    }
  });
}

const warningsOf = (schoolId: string) => getDb().db.select().from(schema.earlyWarnings).where(eq(schema.earlyWarnings.schoolId, schoolId));
const eventsOf = (schoolId: string) =>
  getDb().db.select().from(schema.outboxEvents).where(and(eq(schema.outboxEvents.schoolId, schoolId), eq(schema.outboxEvents.type, 'ksw.early_warning_raised')));

beforeAll(async () => {
  smp = await t.school('smp', 'SMP Peringatan');
  smk = await t.school('smk', 'SMK Peringatan');
  off = await t.school('smp', 'SMP Tanpa Peringatan');
  await getDb().db.insert(schema.schoolCapabilities).values([
    { schoolId: smp, key: 'attendance.mode', value: 'per_period' },
    { schoolId: smp, key: 'pkl.enabled', value: false },
    { schoolId: smk, key: 'attendance.mode', value: 'daily' },
    { schoolId: smk, key: 'pkl.enabled', value: true },
    { schoolId: off, key: 'student.early_warning', value: false },
  ]);
  const people = { kepsek: await t.staff('Kepsek PD'), guruBk: await t.staff('Bu BK PD'), wali: await t.staff('Bu Wali 8B'), otherWali: await t.staff('Bu Wali 8C'), guru: await t.staff('Pak Guru PD'), offAdmin: await t.staff('Kepsek Tanpa') };
  await t.member(smp, people.kepsek.id, 'kepsek');
  await t.member(smp, people.guruBk.id, 'guru_bk');
  await t.member(smp, people.wali.id, 'wali_kelas');
  await t.member(smp, people.otherWali.id, 'wali_kelas');
  await t.member(smp, people.guru.id, 'guru');
  await t.member(off, people.offAdmin.id, 'kepsek');
  const login = async (email: string) => {
    const agent = t.agent();
    await signIn(agent, email).expect(200);
    return agent;
  };
  kepsek = await login(people.kepsek.email);
  guruBk = await login(people.guruBk.email);
  wali = await login(people.wali.email);
  otherWali = await login(people.otherWali.email);
  guru = await login(people.guru.email);
  offAdmin = await login(people.offAdmin.email);

  await seed(smp, '8B', people.wali.id, [
    { name: 'ALPA TIGA HARI', daily: 'HHHHAAA' },
    { name: 'TERLAMBAT TIGA KALI', daily: 'HTHTHHT' },
    { name: 'BOLOS JAM', daily: 'HHHHHHH', bolos: [3, 0] },
    { name: 'PKL TIDAK DIPANTAU', daily: 'HHHHHHH', pkl: [2, 1] },
    { name: 'RAJIN', daily: 'HHHHHHH' },
    { name: 'IZIN SAKIT', daily: 'HHHSISI' },
  ]);
  await seed(smp, '8C', people.otherWali.id, [{ name: 'ALPA KELAS C', daily: 'HHHHAAAA' }]);
  await seed(smk, 'XI-TKJ', null, [{ name: 'PKL ALPA BERULANG', daily: 'HHHHHHH', bolos: [1, 0], pkl: [2, 0] }]);
  await seed(off, '8A', null, [{ name: 'ALPA TANPA FITUR', daily: 'HHHHAAA' }]);
});

describe('ksw.early-warning (KSW-04)', () => {
  it('does nothing before 18.00 on the school clock', async () => {
    await raiseEarlyWarnings(afternoon);
    expect(await warningsOf(smp)).toHaveLength(0);
    expect(await getDb().db.select().from(schema.earlyWarningRuns).where(eq(schema.earlyWarningRuns.schoolId, smp))).toHaveLength(0);
  });

  it('raises the patterns the school looks for, and only those', async () => {
    await raiseEarlyWarnings(evening);
    const items = names(await list(kepsek, smp).expect(200));
    expect(kindsOf(items, 'ALPA TIGA HARI')).toEqual(['consecutive_alpa']);
    expect(kindsOf(items, 'TERLAMBAT TIGA KALI')).toEqual(['repeated_late']);
    expect(kindsOf(items, 'BOLOS JAM')).toEqual(['bolos_jam']);
    expect(kindsOf(items, 'PKL TIDAK DIPANTAU')).toEqual([]); // PKL is off at this school
    expect(kindsOf(items, 'RAJIN')).toEqual([]);
    expect(kindsOf(items, 'IZIN SAKIT')).toEqual([]);
    expect(items.find((w) => w.student.name === 'ALPA TIGA HARI')).toMatchObject({ date: today, dates: [day(2), day(1), day(0)], student: { className: '8B' } });
    expect(items.find((w) => w.student.name === 'BOLOS JAM')?.dates).toEqual([day(3), day(0)]);
  });

  it('follows the capabilities, not the level: attendance per day means no bolos jam, PKL on means PKL absence', async () => {
    const items = names(await list(kepsek, smp).expect(200));
    expect(items.some((w) => w.student.name === 'PKL ALPA BERULANG')).toBe(false);
    const rows = await warningsOf(smk);
    expect(rows.map((r) => r.kind)).toEqual(['pkl_absence']); // bolos days were seeded but the school marks attendance per day
    expect(rows[0]?.dates).toEqual([day(2), day(0)]);
  });

  it('does nothing for a school that switched the feature off', async () => {
    expect(await warningsOf(off)).toHaveLength(0);
    const res = await list(offAdmin, off).expect(404);
    expect(res.body).toMatchObject({ code: 'CAPABILITY_DISABLED' });
  });

  it('handles each school day once and does not repeat a kind inside the cooldown', async () => {
    const before = (await warningsOf(smp)).length;
    await raiseEarlyWarnings(new Date(evening.getTime() + 5 * 60_000)); // the next cron tick the same evening
    expect(await warningsOf(smp)).toHaveLength(before);
    await raiseEarlyWarnings(new Date(evening.getTime() + 24 * 3_600_000)); // tomorrow evening, same patterns
    expect(await warningsOf(smp)).toHaveLength(before);
    expect(await getDb().db.select().from(schema.earlyWarningRuns).where(eq(schema.earlyWarningRuns.schoolId, smp))).toHaveLength(2);
  });

  it('emits one event per warning, in the same transaction', async () => {
    expect(await eventsOf(smp)).toHaveLength((await warningsOf(smp)).length);
    expect(await eventsOf(smk)).toHaveLength(1);
    expect(await eventsOf(off)).toHaveLength(0);
  });

  it('shows leaders and guru BK everything, a wali kelas only their class, and refuses a guru', async () => {
    const all = (agent: Agent) => list(agent, smp);
    const idsOf = (res: { body: unknown }) => new Set(names(res).map((w) => w.student.name));
    expect(idsOf(await all(kepsek).expect(200))).toEqual(new Set(['ALPA TIGA HARI', 'TERLAMBAT TIGA KALI', 'BOLOS JAM', 'ALPA KELAS C']));
    expect(idsOf(await all(guruBk).expect(200))).toEqual(idsOf(await all(kepsek)));
    expect(idsOf(await all(wali).expect(200))).toEqual(new Set(['ALPA TIGA HARI', 'TERLAMBAT TIGA KALI', 'BOLOS JAM']));
    expect(idsOf(await all(otherWali).expect(200))).toEqual(new Set(['ALPA KELAS C']));
    await all(guru).expect(403);
  });

  it('limits the list to the days asked for and validates the query', async () => {
    expect(names(await list(kepsek, smp, '?days=1').expect(200)).length).toBeGreaterThan(0);
    for (const q of ['?days=0', '?days=61', '?days=abc']) await list(kepsek, smp, q).expect(400);
  });

  it('keeps warnings inside their school and refuses to change them', async () => {
    expect(names(await list(kepsek, smp).expect(200)).some((w) => w.student.name === 'PKL ALPA BERULANG')).toBe(false);
    const [row] = await warningsOf(smp);
    await expect(withTenant({ schoolId: smp, userId: null }, (tx) => tx.update(schema.earlyWarnings).set({ dates: [] }).where(eq(schema.earlyWarnings.id, row?.id ?? '')))).rejects.toThrow();
    expect(await withTenant({ schoolId: smk, userId: null }, (tx) => tx.select().from(schema.earlyWarnings).where(eq(schema.earlyWarnings.schoolId, smp)))).toHaveLength(0);
  });
});
