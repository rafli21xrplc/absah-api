import type { ClassRecapDetail, ClassStudentHours } from '@absah/contracts';
import { schema } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

const DATE = '2026-11-16'; // a Monday
const bodyOf = <T>(res: { body: unknown }) => res.body as T;
let school: string;
let wali: Agent;
let guruFisika: Agent;
let wakasek: Agent;
let ids: { xi1: string; xi2: string; classSession: string; fisika: string; ekonomi: string; otherClass: string };

beforeAll(async () => {
  school = await t.school('sma', 'SMA Jam Siswa');
  const [w, f, e, k] = await Promise.all([t.staff('Wali XI-1'), t.staff('Guru Fisika'), t.staff('Guru Ekonomi'), t.staff('Wakasek Jam')]);
  for (const [u, role] of [[w, 'guru'], [f, 'guru'], [e, 'guru'], [k, 'wakasek']] as const) await t.member(school, u.id, role);
  wali = t.agent();
  await signIn(wali, w.email).expect(200);
  guruFisika = t.agent();
  await signIn(guruFisika, f.email).expect(200);
  wakasek = t.agent();
  await signIn(wakasek, k.email).expect(200);
  await enableTotp(wakasek);

  ids = await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const yearId = year?.id ?? '';
    const [xi1, xi2] = await tx
      .insert(schema.classes)
      .values([
        { schoolId: school, academicYearId: yearId, name: 'XI-1', grade: 11, stream: 'ipa', homeroomTeacherId: w.id },
        { schoolId: school, academicYearId: yearId, name: 'XI-2', grade: 11, stream: 'ips' },
      ])
      .returning();
    const [ani, bayu, cici] = await tx.insert(schema.students).values([{ schoolId: school, name: 'ANI' }, { schoolId: school, name: 'BAYU' }, { schoolId: school, name: 'CICI' }]).returning();
    const enrol = (studentId: string, classId: string) => ({ schoolId: school, studentId, classId, academicYearId: yearId, startsOn: '2026-07-13' });
    const [eAni, eBayu, eCici] = await tx
      .insert(schema.enrollments)
      .values([enrol(ani?.id ?? '', xi1?.id ?? ''), enrol(bayu?.id ?? '', xi1?.id ?? ''), enrol(cici?.id ?? '', xi2?.id ?? '')])
      .returning();
    const [fis, eko, mtk] = await tx.insert(schema.subjects).values([{ schoolId: school, name: 'Fisika' }, { schoolId: school, name: 'Ekonomi' }, { schoolId: school, name: 'Matematika' }]).returning();
    // Mapel pilihan: Fisika mixes XI-1 and XI-2; Ekonomi has only Bayu.
    const [gFis, gEko] = await tx
      .insert(schema.learningGroups)
      .values([
        { schoolId: school, academicYearId: yearId, subjectId: fis?.id ?? '', teacherId: f.id, name: 'Fisika A' },
        { schoolId: school, academicYearId: yearId, subjectId: eko?.id ?? '', teacherId: e.id, name: 'Ekonomi A' },
      ])
      .returning();
    await tx.insert(schema.learningGroupMembers).values([
      { schoolId: school, learningGroupId: gFis?.id ?? '', enrollmentId: eAni?.id ?? '' },
      { schoolId: school, learningGroupId: gFis?.id ?? '', enrollmentId: eCici?.id ?? '' },
      { schoolId: school, learningGroupId: gEko?.id ?? '', enrollmentId: eBayu?.id ?? '' },
    ]);
    await tx.insert(schema.schedulePeriods).values([
      { schoolId: school, day: 1, number: 1, startsAt: '07:00', endsAt: '07:45' },
      { schoolId: school, day: 1, number: 2, startsAt: '07:45', endsAt: '08:30' },
    ]);
    const slot = { schoolId: school, academicYearId: yearId, day: 1 };
    const [s1, s2, sFis, sEko] = await tx
      .insert(schema.scheduleSlots)
      .values([
        { ...slot, ownerType: 'class' as const, ownerId: xi1?.id ?? '', period: 1, subjectId: mtk?.id ?? '', teacherId: w.id },
        { ...slot, ownerType: 'class' as const, ownerId: xi2?.id ?? '', period: 1, subjectId: mtk?.id ?? '', teacherId: k.id },
        { ...slot, ownerType: 'group' as const, ownerId: gFis?.id ?? '', period: 2, subjectId: fis?.id ?? '', teacherId: f.id },
        { ...slot, ownerType: 'group' as const, ownerId: gEko?.id ?? '', period: 2, subjectId: eko?.id ?? '', teacherId: e.id },
      ])
      .returning();
    const session = (ownerType: 'class' | 'group', ownerId: string, slotId: string, teacherId: string) => ({ schoolId: school, schoolDate: DATE, mode: 'per_period' as const, ownerType, ownerId, slotId, teacherId });
    const made = await tx
      .insert(schema.attendanceSessions)
      .values([
        session('class', xi1?.id ?? '', s1?.id ?? '', w.id),
        session('class', xi2?.id ?? '', s2?.id ?? '', k.id),
        session('group', gFis?.id ?? '', sFis?.id ?? '', f.id),
        session('group', gEko?.id ?? '', sEko?.id ?? '', e.id),
      ])
      .returning();
    return { xi1: xi1?.id ?? '', xi2: xi2?.id ?? '', classSession: made[0]?.id ?? '', otherClass: made[1]?.id ?? '', fisika: made[2]?.id ?? '', ekonomi: made[3]?.id ?? '' };
  });
});

describe('jam siswa per rombel (AKD-10)', () => {
  const hours = (agent: Agent, classId: string, query = `?date=${DATE}`) => agent.get(`/api/v1/classes/${classId}/student-hours${query}`).set('X-School-Id', school);

  it("shows the wali kelas each student's lessons, learning groups included", async () => {
    // The Fisika teacher fills the mixed group: Cici (XI-2) is alpa.
    const cici = bodyOf<{ students: { enrollmentId: string; name: string }[] }>(await guruFisika.get(`/api/v1/sessions/${ids.fisika}`).set('X-School-Id', school).expect(200)).students.find((s) => s.name === 'CICI');
    await guruFisika
      .post(`/api/v1/sessions/${ids.fisika}/submit`)
      .set('X-School-Id', school)
      .set('Idempotency-Key', uuidv7())
      .send({ exceptions: [{ enrollmentId: cici?.enrollmentId, status: 'A' }] })
      .expect(200);

    const day = bodyOf<ClassStudentHours>(await hours(wali, ids.xi1).expect(200));
    expect(day).toMatchObject({ className: 'XI-1', schoolDate: DATE });
    expect(day.sessions.map((s) => s.id).sort()).toEqual([ids.classSession, ids.fisika, ids.ekonomi].sort()); // not XI-2's own lesson
    expect(day.sessions.find((s) => s.id === ids.fisika)).toMatchObject({ owner: { type: 'group', name: 'Fisika A' }, period: { number: 2, startsAt: '07:45' }, subject: { name: 'Fisika' }, teacher: { name: 'Guru Fisika' } });
    const ani = day.students.find((s) => s.name === 'ANI');
    const bayu = day.students.find((s) => s.name === 'BAYU');
    expect(ani?.sessions).toEqual([
      { sessionId: ids.classSession, status: null },
      { sessionId: ids.fisika, status: 'H' },
    ]);
    expect(ani?.daily).toBe('H');
    expect(bayu?.sessions).toEqual([
      { sessionId: ids.classSession, status: null },
      { sessionId: ids.ekonomi, status: null },
    ]);
    expect(day.students.map((s) => s.name)).toEqual(['ANI', 'BAYU']);
  });

  it("counts a learning group's alpa in the student's own rombel rekap", async () => {
    const recap = bodyOf<ClassRecapDetail>(await wakasek.get(`/api/v1/reports/attendance/classes/${ids.xi2}?from=${DATE}&to=${DATE}`).set('X-School-Id', school).expect(200));
    expect(recap.items.find((i) => i.name === 'CICI')?.counts.A).toBe(1);
  });

  it('is for the wali kelas and session viewers only', async () => {
    await hours(guruFisika, ids.xi1).expect(404); // teaches some of them, but is not their wali kelas
    await hours(wali, ids.xi2).expect(404);
    expect(bodyOf<ClassStudentHours>(await hours(wakasek, ids.xi2).expect(200)).sessions.map((s) => s.id).sort()).toEqual([ids.otherClass, ids.fisika].sort());
    await hours(wakasek, uuidv7()).expect(404);
    await hours(wali, ids.xi1, '?date=16-11-2026').expect(400);
  });
});
