import type { ClassHabitWeek, HabitDay, HabitJournal } from '@absah/contracts';
import { schema } from '@absah/db';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { lockHabits } from '../src/modules/activity';
import { mondayOf } from '../src/modules/activity/application/habits';
import { withTenant } from '../src/shared/db';
import { addDays, schoolDate } from '../src/shared/school-date';
import { buildTestApp, signIn, testPhone, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

const today = schoolDate('Asia/Jakarta');
const bodyOf = <T>(res: { body: unknown }) => res.body as T;

async function otpLogin(phoneNumber: string) {
  const agent = t.agent();
  await agent.post('/api/auth/phone-number/send-otp').send({ phoneNumber }).expect(200);
  await agent.post('/api/auth/phone-number/verify').send({ phoneNumber, code: t.messageSender.lastCodeFor(phoneNumber) }).expect(200);
  return agent;
}

/** A school with rombel 1A (wali kelas), two students, a parent of the first and a login for the second. */
async function setup(level: 'sd' | 'smp' | 'sma', name: string) {
  const school = await t.school(level, name);
  const [w, g] = await Promise.all([t.staff(`Wali ${name}`), t.staff(`Guru ${name}`)]);
  await t.member(school, w.id, 'guru');
  await t.member(school, g.id, 'guru');
  const parentUser = await t.parent(testPhone(), `Ortu ${name}`);
  const studentUser = await t.parent(testPhone(), `Siswa ${name}`);
  await t.member(school, parentUser.id, 'orang_tua');
  await t.member(school, studentUser.id, 'siswa');
  const ids = await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: '1A', grade: 1, homeroomTeacherId: w.id }).returning();
    const [a, b] = await tx.insert(schema.students).values([{ schoolId: school, name: 'ANI LESTARI' }, { schoolId: school, name: 'BAYU AJI', userId: studentUser.id }]).returning();
    const [ea] = await tx
      .insert(schema.enrollments)
      .values([
        { schoolId: school, studentId: a?.id ?? '', classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' },
        { schoolId: school, studentId: b?.id ?? '', classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' },
      ])
      .returning();
    const [guardian] = await tx.insert(schema.guardians).values({ schoolId: school, name: `Ortu ${name}`, userId: parentUser.id }).returning();
    await tx.insert(schema.studentGuardians).values({ schoolId: school, studentId: a?.id ?? '', guardianId: guardian?.id ?? '', relation: 'ibu', isPrimary: true });
    return { classId: cls?.id ?? '', ani: a?.id ?? '', bayu: b?.id ?? '', aniEnrollment: ea?.id ?? '' };
  });
  const wali = t.agent();
  await signIn(wali, w.email).expect(200);
  const guru = t.agent();
  await signIn(guru, g.email).expect(200);
  return { school, ...ids, wali, guru, parent: await otpLogin(parentUser.phoneNumber), student: await otpLogin(studentUser.phoneNumber) };
}

describe('jurnal 7 KAIH (KEG-02)', () => {
  let sd: Awaited<ReturnType<typeof setup>>;
  const put = (agent: Agent, studentId: string, date: string, habits: object) =>
    agent.put(`/api/v1/habits/${studentId}/${date}`).set('X-School-Id', sd.school).set('Idempotency-Key', uuidv7()).send({ habits });
  const journal = (agent: Agent, studentId: string, query = '') => agent.get(`/api/v1/habits/${studentId}${query}`).set('X-School-Id', sd.school);

  beforeAll(async () => {
    sd = await setup('sd', 'SD Kebiasaan');
  });

  it('lets the parent tick (mode parent), keeps habits not sent, and refuses everyone else', async () => {
    const day = bodyOf<HabitDay>(await put(sd.parent, sd.ani, today, { bangun_pagi: true, beribadah: false }).expect(200));
    expect(day).toMatchObject({ date: today, filledBy: 'orang_tua', locked: false, habits: { bangun_pagi: true, beribadah: false, berolahraga: null } });
    const again = bodyOf<HabitDay>(await put(sd.parent, sd.ani, today, { berolahraga: true }).expect(200));
    expect(again.habits).toMatchObject({ bangun_pagi: true, beribadah: false, berolahraga: true });

    await put(sd.parent, sd.ani, today, {}).expect(400);
    await put(sd.parent, sd.ani, addDays(today, 1), { tidur_cepat: true }).expect(400);
    await put(sd.parent, sd.ani, addDays(today, -2), { tidur_cepat: true }).expect(200);
    expect(bodyOf<{ details: unknown }>(await put(sd.parent, sd.ani, addDays(today, -3), { tidur_cepat: true }).expect(409)).details).toEqual({ reason: 'locked' });

    // The wali kelas reads but does not tick; another teacher and another child's parent see nothing.
    expect(bodyOf<{ details: unknown }>(await put(sd.wali, sd.ani, today, { tidur_cepat: true }).expect(409)).details).toEqual({ reason: 'not_filler', mode: 'parent' });
    await put(sd.student, sd.bayu, today, { tidur_cepat: true }).expect(409); // mode parent: not the student
    await journal(sd.guru, sd.ani).expect(404);
    await journal(sd.parent, sd.bayu).expect(404);

    const read = bodyOf<HabitJournal>(await journal(sd.wali, sd.ani).expect(200));
    expect(read).toMatchObject({ name: 'ANI LESTARI', mode: 'parent', canEdit: false, editableFrom: addDays(today, -2) });
    expect(read.days).toHaveLength(7);
    expect(read.days[0]).toMatchObject({ date: today, habits: { berolahraga: true } });
    expect(read.days[3]).toMatchObject({ date: addDays(today, -3), locked: true, filledBy: null });
    expect(bodyOf<HabitJournal>(await journal(sd.parent, sd.ani).expect(200)).canEdit).toBe(true);
    await journal(sd.parent, sd.ani, `?from=${addDays(today, -40)}`).expect(400);
  });

  it('sums the week per student for the wali kelas', async () => {
    const week = bodyOf<ClassHabitWeek>(await sd.wali.get(`/api/v1/classes/${sd.classId}/habits?weekStart=${today}`).set('X-School-Id', sd.school).expect(200));
    expect(week.weekStart).toBe(mondayOf(today));
    expect(week.weekEnd).toBe(addDays(mondayOf(today), 6));
    const ani = week.students.find((s) => s.name === 'ANI LESTARI');
    const inWeek = [today, addDays(today, -2)].filter((d) => d >= week.weekStart).length;
    expect(ani?.daysFilled).toBe(inWeek);
    expect(ani?.counts.bangun_pagi).toBe(1);
    expect(ani?.counts.beribadah).toBe(0);
    expect(week.students.find((s) => s.name === 'BAYU AJI')).toMatchObject({ daysFilled: 0, counts: { tidur_cepat: 0 } });
    await sd.guru.get(`/api/v1/classes/${sd.classId}/habits`).set('X-School-Id', sd.school).expect(404);
  });

  it('locks entries older than 2 days (keg.lock-habits)', async () => {
    await withTenant({ schoolId: sd.school, userId: null }, (tx) =>
      tx.insert(schema.habitEntries).values({ schoolId: sd.school, enrollmentId: sd.aniEnrollment, schoolDate: addDays(today, -5), habit: 'gemar_belajar', value: true, filledByRole: 'orang_tua' }),
    );
    expect(await lockHabits()).toBeGreaterThanOrEqual(1);
    const rows = await withTenant({ schoolId: sd.school, userId: null }, (tx) => tx.select().from(schema.habitEntries).where(eq(schema.habitEntries.enrollmentId, sd.aniEnrollment)));
    expect(rows.filter((r) => r.schoolDate < addDays(today, -2)).every((r) => r.lockedAt !== null)).toBe(true);
    expect(rows.filter((r) => r.schoolDate >= addDays(today, -2)).every((r) => r.lockedAt === null)).toBe(true);
  });

  it('lets the student tick in mode student (SMP), not the parent; off without habits.kaih', async () => {
    const smp = await setup('smp', 'SMP Kebiasaan');
    const putSmp = (agent: Agent, studentId: string) =>
      agent.put(`/api/v1/habits/${studentId}/${today}`).set('X-School-Id', smp.school).set('Idempotency-Key', uuidv7()).send({ habits: { gemar_belajar: true } });
    expect(bodyOf<HabitDay>(await putSmp(smp.student, smp.bayu).expect(200)).filledBy).toBe('siswa');
    await putSmp(smp.parent, smp.ani).expect(409);
    await putSmp(smp.student, smp.ani).expect(404);

    const sma = await setup('sma', 'SMA Kebiasaan');
    await sma.wali.get(`/api/v1/habits/${sma.ani}`).set('X-School-Id', sma.school).expect(404);
  });
});
