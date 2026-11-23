import { schema } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb } from '../src/shared/db';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';
import { fixture, importer } from './import-helpers';

const t = buildTestApp();
afterAll(() => t.cleanup());

let operator: Agent;
let guruAgent: Agent;
let school: string;
let guru1: string;
let guru2: string;
let outsider: string;
let classes: Record<string, string>;
let math: string;

type Conflict = { kind: string; with: string; teacher: string | null; studentCount: number; students: string[] };
const key = () => `sched-${uuidv7()}`;
const put = (body: object) => operator.put('/api/v1/schedule/slots').set('X-School-Id', school).set('Idempotency-Key', key()).send(body);
const slot = (owner: string, day: number, period: number, teacherId: string | null, ownerType = 'class') => ({
  ownerType,
  ownerId: owner,
  day,
  period,
  subjectId: math,
  teacherId,
});
const periods = (days: number[], count: number) => ({
  days: days.map((day) => ({
    day,
    periods: Array.from({ length: count }, (_, i) => ({
      number: i + 1,
      startsAt: `${String(7 + i).padStart(2, '0')}:00`,
      endsAt: `${String(7 + i).padStart(2, '0')}:45`,
    })),
  })),
});

beforeAll(async () => {
  const o = await t.staff('Operator Jadwal');
  operator = t.agent();
  await signIn(operator, o.email).expect(200);
  await enableTotp(operator);
  const g1 = await t.staff('Pak Andi');
  const g2 = await t.staff('Bu Sari');
  const x = await t.staff('Orang Luar');
  guru1 = g1.id;
  guru2 = g2.id;
  outsider = x.id;
  guruAgent = t.agent();
  await signIn(guruAgent, g1.email).expect(200);

  school = await t.school('smp', 'SMP Jadwal');
  await t.member(school, o.id, 'operator');
  await t.member(school, guru1, 'guru');
  await t.member(school, guru2, 'guru');
  const imports = importer(t, operator, school);
  const ready = await imports.prepare(await fixture('daftar-pd-awal.xlsx'));
  await imports.commit(ready.id).expect(200);

  const list = (await operator.get('/api/v1/classes').set('X-School-Id', school).expect(200)).body as { items: { id: string; name: string }[] };
  classes = Object.fromEntries(list.items.map((c) => [c.name, c.id]));
  const subject = await operator.post('/api/v1/subjects').set('X-School-Id', school).set('Idempotency-Key', key()).send({ name: 'Matematika', code: 'MTK' }).expect(200);
  math = (subject.body as { id: string }).id;
});

describe('jam pelajaran and subjects', () => {
  it('validates and replaces jam pelajaran', async () => {
    const bad = { days: [{ day: 1, periods: [{ number: 1, startsAt: '08:00', endsAt: '07:00' }] }] };
    await operator.put('/api/v1/schedule/periods').set('X-School-Id', school).set('Idempotency-Key', key()).send(bad).expect(400);
    const res = await operator.put('/api/v1/schedule/periods').set('X-School-Id', school).set('Idempotency-Key', key()).send(periods([1, 2, 3, 4, 5], 4)).expect(200);
    expect((res.body as { days: unknown[] }).days).toHaveLength(5);
    const got = await guruAgent.get('/api/v1/schedule/periods').set('X-School-Id', school).expect(200);
    expect((got.body as { days: { periods: { startsAt: string }[] }[] }).days[0]?.periods[0]?.startsAt).toBe('07:00');
  });

  it('keeps subject names unique', async () => {
    await operator.post('/api/v1/subjects').set('X-School-Id', school).set('Idempotency-Key', key()).send({ name: 'Matematika' }).expect(409);
    const list = await guruAgent.get('/api/v1/subjects').set('X-School-Id', school).expect(200);
    expect((list.body as { items: { name: string }[] }).items.map((s) => s.name)).toEqual(['Matematika']);
  });
});

describe('PUT /schedule/slots', () => {
  it('refuses a teacher in two rombel at the same time', async () => {
    await put(slot(classes['VII A'] ?? '', 1, 1, guru1)).expect(200);
    const res = await put(slot(classes['VII B'] ?? '', 1, 1, guru1)).expect(409);
    expect(res.body).toMatchObject({ code: 'SCHEDULE_CONFLICT' });
    expect((res.body as { details: { conflicts: Conflict[] } }).details.conflicts).toEqual([
      { kind: 'teacher', day: 1, period: 1, with: 'VII A', teacher: 'Pak Andi', studentCount: 0, students: [] },
    ]);
    await put(slot(classes['VII B'] ?? '', 1, 1, guru2)).expect(200);
    // Replacing the rombel's own lesson at that time is not a conflict.
    await put(slot(classes['VII A'] ?? '', 1, 1, guru1)).expect(200);
  });

  it('refuses a student in a rombel lesson and a group lesson at the same time', async () => {
    const { db } = getDb();
    const [year] = await db.select().from(schema.academicYears).where(eq(schema.academicYears.schoolId, school));
    const [aditya] = await db.select().from(schema.students).where(and(eq(schema.students.schoolId, school), eq(schema.students.name, 'ADITYA PRATAMA')));
    const [enrollment] = await db.select().from(schema.enrollments).where(eq(schema.enrollments.studentId, aditya?.id ?? ''));
    const [group] = await db
      .insert(schema.learningGroups)
      .values({ schoolId: school, academicYearId: year?.id ?? '', subjectId: math, name: 'Informatika Pilihan' })
      .returning();
    await db.insert(schema.learningGroupMembers).values({ schoolId: school, learningGroupId: group?.id ?? '', enrollmentId: enrollment?.id ?? '' });

    const res = await put(slot(group?.id ?? '', 1, 1, null, 'group')).expect(409);
    expect((res.body as { details: { conflicts: Conflict[] } }).details.conflicts).toEqual([
      expect.objectContaining({ kind: 'student', with: 'VII A', studentCount: 1, students: ['ADITYA PRATAMA'] }),
    ]);
    await put(slot(group?.id ?? '', 1, 2, null, 'group')).expect(200);
    const back = await put(slot(classes['VII A'] ?? '', 1, 2, guru2)).expect(409);
    expect((back.body as { details: { conflicts: Conflict[] } }).details.conflicts[0]).toMatchObject({ kind: 'student', with: 'Informatika Pilihan' });
  });

  it('needs a configured period, a staff teacher and a schedule manager', async () => {
    await put(slot(classes['VIII A'] ?? '', 6, 1, null)).expect(400); // no Saturday periods
    await put(slot(classes['VIII A'] ?? '', 2, 1, outsider)).expect(400);
    await guruAgent.put('/api/v1/schedule/slots').set('X-School-Id', school).set('Idempotency-Key', key()).send(slot(classes['VIII A'] ?? '', 2, 1, null)).expect(403);
  });

  it('lists a teacher timetable and keeps periods that still have lessons', async () => {
    const res = await guruAgent.get('/api/v1/schedule').query({ teacherId: guru1 }).set('X-School-Id', school).expect(200);
    expect((res.body as { slots: { ownerName: string; day: number; period: number }[] }).slots.map((s) => [s.ownerName, s.day, s.period])).toEqual([['VII A', 1, 1]]);
    await guruAgent.get('/api/v1/schedule').set('X-School-Id', school).expect(400);
    await operator.put('/api/v1/schedule/periods').set('X-School-Id', school).set('Idempotency-Key', key()).send(periods([2, 3], 4)).expect(409);

    const lesson = (res.body as { slots: { id: string }[] }).slots[0]?.id ?? '';
    await operator.delete(`/api/v1/schedule/slots/${lesson}`).set('X-School-Id', school).set('Idempotency-Key', key()).expect(204);
    await operator.delete(`/api/v1/schedule/slots/${lesson}`).set('X-School-Id', school).set('Idempotency-Key', key()).expect(404);
  });
});

describe('PATCH /classes/{id}', () => {
  it('sets the wali kelas to an active staff member', async () => {
    const id = classes['VII A'] ?? '';
    const res = await operator.patch(`/api/v1/classes/${id}`).set('X-School-Id', school).set('Idempotency-Key', key()).send({ homeroomTeacherId: guru2 }).expect(200);
    expect(res.body).toMatchObject({ name: 'VII A', homeroomTeacher: { id: guru2, name: 'Bu Sari' } });
    await operator.patch(`/api/v1/classes/${id}`).set('X-School-Id', school).set('Idempotency-Key', key()).send({ homeroomTeacherId: outsider }).expect(400);
    const cleared = await operator.patch(`/api/v1/classes/${id}`).set('X-School-Id', school).set('Idempotency-Key', key()).send({ homeroomTeacherId: null }).expect(200);
    expect((cleared.body as { homeroomTeacher: unknown }).homeroomTeacher).toBeNull();
  });
});
