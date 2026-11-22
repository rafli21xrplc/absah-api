import { schema } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let wali: Agent;
let other: Agent;
let school: string;
let students: Record<string, string>;
let openId: string;
let lockedId: string;
const CAPTURED = '2026-11-23T00:41:00Z'; // 07.41 WIB

type Result = { outcome: string; session: { id: string } | null; corrections: { toStatus: string; fromStatus: string | null; reason: string; student: { name: string } }[]; skipped: number };
const sync = (agent: Agent, id: string, body: object, headers: Record<string, string> = { 'Idempotency-Key': uuidv7() }) =>
  agent.post(`/api/v1/sessions/${id}/sync`).set('X-School-Id', school).set(headers).send(body);
const statusOf = async (sessionId: string, name: string) => {
  const [row] = await getDb()
    .db.select({ status: schema.attendanceRecords.status, source: schema.attendanceRecords.source })
    .from(schema.attendanceRecords)
    .where(and(eq(schema.attendanceRecords.sessionId, sessionId), eq(schema.attendanceRecords.enrollmentId, students[name] ?? '')));
  return row;
};

beforeAll(async () => {
  school = await t.school('sd', 'SD Sinkron');
  const w = await t.staff('Bu Wali Sinkron');
  const o = await t.staff('Pak Guru Lain');
  await t.member(school, w.id, 'guru');
  await t.member(school, o.id, 'guru');
  wali = t.agent();
  await signIn(wali, w.email).expect(200);
  other = t.agent();
  await signIn(other, o.email).expect(200);

  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: '2B', grade: 2, homeroomTeacherId: w.id }).returning();
    const rows = await tx.insert(schema.students).values(['ANI', 'BUDI', 'CICI', 'DEDE'].map((name) => ({ schoolId: school, name }))).returning();
    const enrolled = await tx
      .insert(schema.enrollments)
      .values(rows.map((s) => ({ schoolId: school, studentId: s.id, classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' })))
      .returning();
    students = Object.fromEntries(rows.map((s, i) => [s.name, enrolled[i]?.id ?? '']));
    const session = (date: string, extra: object) =>
      tx.insert(schema.attendanceSessions).values({ schoolId: school, schoolDate: date, mode: 'daily', ownerType: 'class', ownerId: cls?.id ?? '', teacherId: w.id, ...extra }).returning();
    openId = (await session('2026-11-20', {}))[0]?.id ?? '';
    lockedId = (await session('2026-11-19', { status: 'locked', lockedAt: new Date() }))[0]?.id ?? '';
    await tx.insert(schema.attendanceRecords).values([
      { schoolId: school, sessionId: lockedId, enrollmentId: students.ANI ?? '', status: 'H', source: 'teacher' },
      { schoolId: school, sessionId: lockedId, enrollmentId: students.BUDI ?? '', status: 'A', source: 'teacher' },
      { schoolId: school, sessionId: lockedId, enrollmentId: students.CICI ?? '', status: 'H', source: 'teacher' },
      { schoolId: school, sessionId: lockedId, enrollmentId: students.DEDE ?? '', status: 'S', source: 'leave' }, // izin: the teacher cannot override
    ]);
  });
});

describe('a session filled offline (PRS-08)', () => {
  it('is submitted as usual while the session is still open, and sending it again changes nothing', async () => {
    const body = { exceptions: [{ enrollmentId: students.BUDI, status: 'A' }], capturedAt: CAPTURED };
    const res = await sync(wali, openId, body).expect(200);
    const result = res.body as Result;
    expect(result).toMatchObject({ outcome: 'submitted', corrections: [], skipped: 0 });
    expect(result.session?.id).toBe(openId);
    expect(await statusOf(openId, 'BUDI')).toEqual({ status: 'A', source: 'teacher' });
    expect(await statusOf(openId, 'ANI')).toEqual({ status: 'H', source: 'teacher' });
    expect(((await sync(wali, openId, body).expect(200)).body as Result).outcome).toBe('submitted');
  });

  it('is not refused when the session was locked meanwhile: the differences become correction requests', async () => {
    const body = { exceptions: [{ enrollmentId: students.BUDI, status: 'S' }, { enrollmentId: students.CICI, status: 'A' }, { enrollmentId: students.DEDE, status: 'A' }], capturedAt: CAPTURED };
    const res = await sync(wali, lockedId, body).expect(200);
    const result = res.body as Result;
    expect(result.outcome).toBe('correction_requested');
    expect(result.session).toBeNull();
    expect(result.corrections.map((c) => [c.student.name, c.fromStatus, c.toStatus]).sort()).toEqual([['BUDI', 'A', 'S'], ['CICI', 'H', 'A']]);
    expect(result.corrections[0]?.reason).toMatch(/^Diisi saat offline \(23 Nov 2026 07\.41\); sesi sudah terkunci/);
    expect(result.skipped).toBe(2); // ANI is the same as recorded, DEDE is izin
    expect(await statusOf(lockedId, 'BUDI')).toEqual({ status: 'A', source: 'teacher' }); // nothing changed before a decision
  });

  it('does not file the same request twice, and says so when nothing is left to ask', async () => {
    const body = { exceptions: [{ enrollmentId: students.BUDI, status: 'S' }, { enrollmentId: students.CICI, status: 'A' }], capturedAt: CAPTURED };
    const again = (await sync(wali, lockedId, body).expect(200)).body as Result;
    expect(again).toMatchObject({ outcome: 'unchanged', corrections: [], skipped: 4 });
    const pending = await getDb().db.select().from(schema.correctionRequests).where(eq(schema.correctionRequests.sessionId, lockedId));
    expect(pending).toHaveLength(2);
  });

  it('keeps the rules of a submit: a student not on the roster, a bad body, someone else’s session (not theirs to see)', async () => {
    await sync(wali, openId, { exceptions: [{ enrollmentId: uuidv7(), status: 'A' }], capturedAt: CAPTURED }).expect(400);
    await sync(wali, openId, { exceptions: [] }).expect(400); // capturedAt is required
    await sync(other, openId, { exceptions: [], capturedAt: CAPTURED }).expect(404);
    await sync(other, lockedId, { exceptions: [], capturedAt: CAPTURED }).expect(404);
    await sync(wali, uuidv7(), { exceptions: [], capturedAt: CAPTURED }).expect(404);
  });
});
