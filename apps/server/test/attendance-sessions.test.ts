import { schema } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { schoolDate } from '../src/shared/school-date';
import { buildTestApp, enableTotp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let wali: Agent;
let otherGuru: Agent;
let operator: Agent;
let school: string;
let sessionId: string;
let students: Record<string, string>; // name -> enrollment id
const today = schoolDate('Asia/Jakarta');
const key = () => `sesi-${uuidv7()}`;

type Detail = { status: string; counts: { students: number; filled: number; absent: number }; students: { name: string; status: string | null; source: string | null; fixed: boolean }[] };
const statuses = (d: Detail) => Object.fromEntries(d.students.map((s) => [s.name, [s.status, s.source, s.fixed]]));
const submit = (agent: Agent, body: object, id = sessionId) =>
  agent.post(`/api/v1/sessions/${id}/submit`).set('X-School-Id', school).set('Idempotency-Key', key()).send(body);

beforeAll(async () => {
  school = await t.school('sd', 'SD Sesi Harian');
  const w = await t.staff('Bu Wali');
  const g = await t.staff('Pak Guru Lain');
  const o = await t.staff('Operator Sesi');
  await t.member(school, w.id, 'guru');
  await t.member(school, g.id, 'guru');
  await t.member(school, o.id, 'operator');
  wali = t.agent();
  await signIn(wali, w.email).expect(200);
  otherGuru = t.agent();
  await signIn(otherGuru, g.email).expect(200);
  operator = t.agent();
  await signIn(operator, o.email).expect(200);
  await enableTotp(operator);

  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: '1A', grade: 1, homeroomTeacherId: w.id }).returning();
    const rows = await tx.insert(schema.students).values(['ANI', 'BUDI', 'CITRA'].map((name) => ({ schoolId: school, name }))).returning();
    const enrolled = await tx
      .insert(schema.enrollments)
      .values(rows.map((s) => ({ schoolId: school, studentId: s.id, classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' })))
      .returning();
    students = Object.fromEntries(rows.map((s, i) => [s.name, enrolled[i]?.id ?? '']));
    const [session] = await tx
      .insert(schema.attendanceSessions)
      .values({ schoolId: school, schoolDate: today, mode: 'daily', ownerType: 'class', ownerId: cls?.id ?? '', teacherId: w.id })
      .returning();
    sessionId = session?.id ?? '';
    // CITRA has an approved izin (written by the leave module in prompt 2.4).
    await tx.insert(schema.attendanceRecords).values({ schoolId: school, sessionId, enrollmentId: students.CITRA ?? '', status: 'I', source: 'leave' });
  });
});

describe('Hari ini', () => {
  it('shows the wali kelas their daily session, and the whole school to managers', async () => {
    const mine = await wali.get('/api/v1/attendance/today').set('X-School-Id', school).expect(200);
    expect(mine.body).toMatchObject({ schoolDate: today, sessions: [{ id: sessionId, mode: 'daily', owner: { name: '1A' }, canFill: true }] });
    expect((mine.body as { sessions: Detail[] }).sessions[0]?.counts).toEqual({ students: 3, filled: 1, absent: 1 });

    const other = await otherGuru.get('/api/v1/attendance/today').set('X-School-Id', school).expect(200);
    expect((other.body as { sessions: unknown[] }).sessions).toEqual([]);
    await otherGuru.get('/api/v1/attendance/today').query({ scope: 'all' }).set('X-School-Id', school).expect(403);
    const all = await operator.get('/api/v1/attendance/today').query({ scope: 'all' }).set('X-School-Id', school).expect(200);
    expect((all.body as { sessions: { id: string }[] }).sessions.map((s) => s.id)).toEqual([sessionId]);
  });
});

describe('POST /sessions/{id}/submit', () => {
  it('fills everyone H except the exceptions, keeping the izin', async () => {
    const before = await wali.get(`/api/v1/sessions/${sessionId}`).set('X-School-Id', school).expect(200);
    expect(statuses(before.body as Detail)).toEqual({ ANI: [null, null, false], BUDI: [null, null, false], CITRA: ['I', 'leave', true] });

    const body = { exceptions: [{ enrollmentId: students.BUDI, status: 'A' }, { enrollmentId: students.CITRA, status: 'A' }] };
    const res = await submit(wali, body).expect(200);
    expect((res.body as Detail).status).toBe('submitted');
    expect(statuses(res.body as Detail)).toEqual({ ANI: ['H', 'teacher', false], BUDI: ['A', 'teacher', false], CITRA: ['I', 'leave', true] });

    const daily = await withTenant({ schoolId: school, userId: null }, (tx) => tx.select().from(schema.dailyAttendance));
    expect(Object.fromEntries(daily.map((d) => [d.enrollmentId, d.status]))).toEqual({ [students.ANI ?? '']: 'H', [students.BUDI ?? '']: 'A', [students.CITRA ?? '']: 'I' });
  });

  it('sending twice does not duplicate records or alpa notifications', async () => {
    const body = { exceptions: [{ enrollmentId: students.BUDI, status: 'A' }] };
    await submit(wali, body).expect(200);
    await submit(wali, body).expect(200);
    const { db } = getDb();
    const records = await db.select().from(schema.attendanceRecords).where(eq(schema.attendanceRecords.sessionId, sessionId));
    expect(records).toHaveLength(3);
    const events = await db
      .select({ payload: schema.outboxEvents.payload })
      .from(schema.outboxEvents)
      .where(and(eq(schema.outboxEvents.schoolId, school), eq(schema.outboxEvents.type, 'attendance.absent_marked')));
    expect(events.map((e) => (e.payload as { enrollmentId: string }).enrollmentId)).toEqual([students.BUDI]);
  });

  it('is refused for other teachers, students not on the roster, and locked sessions', async () => {
    await submit(otherGuru, { exceptions: [] }).expect(404);
    await submit(wali, { exceptions: [{ enrollmentId: uuidv7(), status: 'S' }] }).expect(400);
    await submit(operator, { exceptions: [] }).expect(200); // managers may fill for the teacher

    await getDb().db.update(schema.attendanceSessions).set({ status: 'locked', lockedAt: new Date() }).where(eq(schema.attendanceSessions.id, sessionId));
    const locked = await submit(wali, { exceptions: [] }).expect(409);
    expect((locked.body as { code: string }).code).toBe('SESSION_LOCKED');
    const today2 = await wali.get('/api/v1/attendance/today').set('X-School-Id', school).expect(200);
    expect((today2.body as { sessions: { canFill: boolean }[] }).sessions[0]?.canFill).toBe(false);
  });
});
