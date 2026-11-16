import { schema } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attendanceConsumers, findSchool, generateForSchool } from '../src/modules/attendance';
import { getDb, withPlatform, withTenant } from '../src/shared/db';
import { runConsumer } from '../src/shared/outbox';
import { addDays, schoolDate } from '../src/shared/school-date';
import { buildTestApp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let parent: Agent;
let wali: Agent;
let school: string;
let students: Record<string, string>; // name -> enrollment id
const key = () => `izin-sesi-${uuidv7()}`;

/** The next Monday after today (school days Mon-Fri: no jam pelajaran, no calendar exceptions). */
const today = schoolDate('Asia/Jakarta');
let monday = addDays(today, 1);
while (new Date(`${monday}T00:00:00Z`).getUTCDay() !== 1) monday = addDays(monday, 1);
const days = [monday, addDays(monday, 1), addDays(monday, 2)];

const post = (agent: Agent, path: string, body: object = {}) =>
  agent.post(`/api/v1${path}`).set('X-School-Id', school).set('Idempotency-Key', key()).send(body);

/** What the worker does once the outbox relays a leave event. */
async function deliver(type: 'leave.approved' | 'leave.cancelled', leaveRequestId: string) {
  const consumer = attendanceConsumers().find((c) => c.event === type);
  if (!consumer) throw new Error(`no consumer for ${type}`);
  return runConsumer(consumer, { id: uuidv7(), schoolId: school, type, payload: { leaveRequestId }, traceId: null, occurredAt: new Date().toISOString() });
}

async function generate(date: string) {
  const row = await withPlatform((tx) => findSchool(tx, school));
  if (!row) throw new Error('no school');
  return generateForSchool(row, date, new Date());
}

/** Status/source per student name in the class session of a date. */
async function sessionOf(date: string) {
  const { db } = getDb();
  const [session] = await db
    .select({ id: schema.attendanceSessions.id })
    .from(schema.attendanceSessions)
    .where(and(eq(schema.attendanceSessions.schoolId, school), eq(schema.attendanceSessions.schoolDate, date)));
  const records = session
    ? await db
        .select({ enrollmentId: schema.attendanceRecords.enrollmentId, status: schema.attendanceRecords.status, source: schema.attendanceRecords.source })
        .from(schema.attendanceRecords)
        .where(eq(schema.attendanceRecords.sessionId, session.id))
    : [];
  const byName = Object.fromEntries(
    Object.entries(students).map(([name, id]) => {
      const r = records.find((x) => x.enrollmentId === id);
      return [name, r ? `${r.status}:${r.source}` : null];
    }),
  );
  return { id: session?.id ?? '', records: byName };
}

beforeAll(async () => {
  school = await t.school('sd', 'SD Izin Sesi');
  const p = await t.staff('Bapak Joko');
  const w = await t.staff('Bu Wali Sesi');
  await t.member(school, p.id, 'orang_tua');
  await t.member(school, w.id, 'guru');
  parent = t.agent();
  await signIn(parent, p.email).expect(200);
  wali = t.agent();
  await signIn(wali, w.email).expect(200);

  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: '4B', grade: 4, homeroomTeacherId: w.id }).returning();
    const rows = await tx.insert(schema.students).values(['RAKA', 'SALSA'].map((name) => ({ schoolId: school, name }))).returning();
    const enrolled = await tx
      .insert(schema.enrollments)
      .values(rows.map((s) => ({ schoolId: school, studentId: s.id, classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' })))
      .returning();
    students = Object.fromEntries(rows.map((s, i) => [s.name, enrolled[i]?.id ?? '']));
    const [guardian] = await tx.insert(schema.guardians).values({ schoolId: school, name: 'Joko', userId: p.id }).returning();
    await tx.insert(schema.studentGuardians).values({ schoolId: school, studentId: rows[0]?.id ?? '', guardianId: guardian?.id ?? '', relation: 'ayah', isPrimary: true });
  });
});

describe('izin fills attendance (IZN -> PRS)', () => {
  let rakaLeave: string;

  it('a three-day izin approved before the sessions exist is filled when they are created', async () => {
    const created = await post(parent, '/leave-requests', { enrollmentId: students.RAKA, kind: 'sakit', startsOn: days[0], endsOn: days[2], reason: 'Cacar air' }).expect(200);
    rakaLeave = (created.body as { id: string }).id;
    await post(wali, `/leave-requests/${rakaLeave}/decide`, { approve: true }).expect(200);
    expect(await deliver('leave.approved', rakaLeave)).toBe('handled');
    expect(await deliver('leave.approved', rakaLeave)).toBe('handled'); // another event id: re-sync, same result

    for (const date of days) {
      expect(await generate(date)).toEqual({ schoolDate: date, created: 1 });
      expect((await sessionOf(date)).records).toEqual({ RAKA: 'S:leave', SALSA: null });
    }
    const daily = await getDb()
      .db.select({ status: schema.dailyAttendance.status })
      .from(schema.dailyAttendance)
      .where(eq(schema.dailyAttendance.enrollmentId, students.RAKA ?? ''));
    expect(daily.map((d) => d.status)).toEqual(['S', 'S', 'S']);

    // The wali kelas fills the day: RAKA stays S (shown fixed), the rest is the teacher's.
    const { id } = await sessionOf(days[0] ?? '');
    const res = await post(wali, `/sessions/${id}/submit`, { exceptions: [{ enrollmentId: students.SALSA, status: 'A' }] }).expect(200);
    const fixed = (res.body as { students: { name: string; fixed: boolean }[] }).students.filter((s) => s.fixed).map((s) => s.name);
    expect(fixed).toEqual(['RAKA']);
    expect((await sessionOf(days[0] ?? '')).records).toEqual({ RAKA: 'S:leave', SALSA: 'A:teacher' });
  });

  it('a cancelled izin brings back the next source: the teacher, or nothing', async () => {
    const created = await post(wali, '/leave-requests', { enrollmentId: students.SALSA, kind: 'izin', startsOn: days[0], endsOn: days[0], reason: 'Ibu menelepon: acara keluarga' }).expect(200);
    const salsaLeave = (created.body as { id: string; status: string }).id;
    await deliver('leave.approved', salsaLeave);
    expect((await sessionOf(days[0] ?? '')).records).toEqual({ RAKA: 'S:leave', SALSA: 'I:leave' });

    await post(wali, `/leave-requests/${salsaLeave}/cancel`).expect(200);
    await deliver('leave.cancelled', salsaLeave);
    expect((await sessionOf(days[0] ?? '')).records).toEqual({ RAKA: 'S:leave', SALSA: 'A:teacher' });

    await post(parent, `/leave-requests/${rakaLeave}/cancel`).expect(200);
    await deliver('leave.cancelled', rakaLeave);
    for (const date of days) expect((await sessionOf(date)).records.RAKA).toBeNull();
  });

  it('a late approved delivery for a cancelled izin writes nothing', async () => {
    const created = await post(wali, '/leave-requests', { enrollmentId: students.RAKA, kind: 'izin', startsOn: days[1], endsOn: days[1], reason: 'Lomba di kecamatan' }).expect(200);
    const id = (created.body as { id: string }).id;
    await post(wali, `/leave-requests/${id}/cancel`).expect(200);
    await deliver('leave.cancelled', id);
    await deliver('leave.approved', id); // arrived after the cancellation
    expect((await sessionOf(days[1] ?? '')).records.RAKA).toBeNull();
  });
});
