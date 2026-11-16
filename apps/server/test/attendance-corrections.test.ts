import { schema } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp, signIn, type Agent } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let wali: Agent;
let wakasek: Agent;
let school: string;
let sessionId: string;
let students: Record<string, string>;
const key = () => `koreksi-${uuidv7()}`;

type Correction = { id: string; status: string; fromStatus: string | null; toStatus: string; student: { name: string }; requestedBy: { name: string } | null };
const request = (agent: Agent, body: object) =>
  agent.post(`/api/v1/sessions/${sessionId}/corrections`).set('X-School-Id', school).set('Idempotency-Key', key()).send(body);
const decide = (agent: Agent, id: string, body: object) =>
  agent.post(`/api/v1/corrections/${id}/decide`).set('X-School-Id', school).set('Idempotency-Key', key()).send(body);
const recordOf = async (name: string) => {
  const [row] = await getDb()
    .db.select({ status: schema.attendanceRecords.status, source: schema.attendanceRecords.source })
    .from(schema.attendanceRecords)
    .where(and(eq(schema.attendanceRecords.sessionId, sessionId), eq(schema.attendanceRecords.enrollmentId, students[name] ?? '')));
  return row;
};

beforeAll(async () => {
  school = await t.school('sd', 'SD Koreksi');
  const w = await t.staff('Bu Wali Koreksi');
  const k = await t.staff('Pak Wakasek');
  await t.member(school, w.id, 'guru');
  await t.member(school, k.id, 'wakasek');
  wali = t.agent();
  await signIn(wali, w.email).expect(200);
  wakasek = t.agent();
  await signIn(wakasek, k.email).expect(200);

  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: '2B', grade: 2, homeroomTeacherId: w.id }).returning();
    const rows = await tx.insert(schema.students).values(['ANI', 'BUDI'].map((name) => ({ schoolId: school, name }))).returning();
    const enrolled = await tx
      .insert(schema.enrollments)
      .values(rows.map((s) => ({ schoolId: school, studentId: s.id, classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' })))
      .returning();
    students = Object.fromEntries(rows.map((s, i) => [s.name, enrolled[i]?.id ?? '']));
    const [session] = await tx
      .insert(schema.attendanceSessions)
      .values({ schoolId: school, schoolDate: '2026-11-13', mode: 'daily', ownerType: 'class', ownerId: cls?.id ?? '', teacherId: w.id, status: 'submitted' })
      .returning();
    sessionId = session?.id ?? '';
    await tx.insert(schema.attendanceRecords).values([
      { schoolId: school, sessionId, enrollmentId: students.ANI ?? '', status: 'H', source: 'teacher' },
      { schoolId: school, sessionId, enrollmentId: students.BUDI ?? '', status: 'A', source: 'teacher' },
    ]);
  });
});

describe('corrections (PRS-05)', () => {
  it('are only for locked sessions', async () => {
    const res = await request(wali, { changes: [{ enrollmentId: students.BUDI, status: 'S' }], reason: 'Surat dokter menyusul' }).expect(409);
    expect((res.body as { details: { reason: string } }).details.reason).toBe('not_locked');
    await getDb().db.update(schema.attendanceSessions).set({ status: 'locked', lockedAt: new Date() }).where(eq(schema.attendanceSessions.id, sessionId));
  });

  it('are approved by the wakasek and then final', async () => {
    const created = await request(wali, { changes: [{ enrollmentId: students.BUDI, status: 'S' }], reason: 'Surat dokter menyusul' }).expect(200);
    const [correction] = (created.body as { items: Correction[] }).items;
    expect(correction).toMatchObject({ status: 'pending', fromStatus: 'A', toStatus: 'S', student: { name: 'BUDI' }, requestedBy: { name: 'Bu Wali Koreksi' } });
    await request(wali, { changes: [{ enrollmentId: students.BUDI, status: 'I' }], reason: 'Ternyata izin' }).expect(409);

    const own = await wali.get('/api/v1/corrections').set('X-School-Id', school).expect(200);
    expect((own.body as { items: unknown[] }).items).toHaveLength(1);
    await decide(wali, correction?.id ?? '', { approve: true }).expect(403);

    const approved = await decide(wakasek, correction?.id ?? '', { approve: true, note: 'Sudah dicek' }).expect(200);
    expect(approved.body).toMatchObject({ status: 'approved', decidedBy: { name: 'Pak Wakasek' } });
    expect(await recordOf('BUDI')).toEqual({ status: 'S', source: 'manual' });
    const [daily] = await getDb()
      .db.select({ status: schema.dailyAttendance.status })
      .from(schema.dailyAttendance)
      .where(eq(schema.dailyAttendance.enrollmentId, students.BUDI ?? ''));
    expect(daily?.status).toBe('S');
    const audits = await getDb()
      .db.select({ action: schema.auditLogs.action })
      .from(schema.auditLogs)
      .where(and(eq(schema.auditLogs.schoolId, school), eq(schema.auditLogs.action, 'attendance.corrected')));
    expect(audits).toHaveLength(1);
    await decide(wakasek, correction?.id ?? '', { approve: false }).expect(409);
  });

  it('leave the record as it was when rejected, and cannot be decided by their own requester', async () => {
    const created = await request(wali, { changes: [{ enrollmentId: students.ANI, status: 'A' }], reason: 'Salah tekan tadi' }).expect(200);
    const [correction] = (created.body as { items: Correction[] }).items;
    await decide(wakasek, correction?.id ?? '', { approve: false, note: 'Siswa hadir, ada di foto kelas' }).expect(200);
    expect(await recordOf('ANI')).toEqual({ status: 'H', source: 'teacher' });

    const mine = await request(wakasek, { changes: [{ enrollmentId: students.ANI, status: 'T' }], reason: 'Datang terlambat' }).expect(200);
    const [own] = (mine.body as { items: Correction[] }).items;
    await decide(wakasek, own?.id ?? '', { approve: true }).expect(403);
    const pending = await wakasek.get('/api/v1/corrections').set('X-School-Id', school).expect(200);
    expect((pending.body as { items: Correction[] }).items.map((c) => c.toStatus)).toEqual(['T']);
  });
});
