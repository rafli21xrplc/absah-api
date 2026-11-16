import { schema } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { changeMarks } from '../src/modules/attendance/application/marks';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let sessionId: string;
let enrollmentId: string;
const leaveId = uuidv7();
const tenant = () => ({ schoolId: school, userId: null });

const current = async () => {
  const { db } = getDb();
  const [record] = await db
    .select({ status: schema.attendanceRecords.status, source: schema.attendanceRecords.source })
    .from(schema.attendanceRecords)
    .where(eq(schema.attendanceRecords.sessionId, sessionId));
  const [daily] = await db.select({ status: schema.dailyAttendance.status }).from(schema.dailyAttendance).where(eq(schema.dailyAttendance.enrollmentId, enrollmentId));
  return { record: record ?? null, daily: daily?.status ?? null };
};
const alpaEvents = async () =>
  (
    await getDb()
      .db.select({ id: schema.outboxEvents.id })
      .from(schema.outboxEvents)
      .where(and(eq(schema.outboxEvents.schoolId, school), eq(schema.outboxEvents.type, 'attendance.absent_marked')))
  ).length;

beforeAll(async () => {
  school = await t.school('smp', 'SMP Tanda Presensi');
  await withTenant(tenant(), async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: '7A', grade: 7 }).returning();
    const [student] = await tx.insert(schema.students).values({ schoolId: school, name: 'DEWI' }).returning();
    const [enrolment] = await tx
      .insert(schema.enrollments)
      .values({ schoolId: school, studentId: student?.id ?? '', classId: cls?.id ?? '', academicYearId: year?.id ?? '', startsOn: '2026-07-13' })
      .returning();
    enrollmentId = enrolment?.id ?? '';
    const [session] = await tx
      .insert(schema.attendanceSessions)
      .values({ schoolId: school, schoolDate: '2026-11-17', mode: 'daily', ownerType: 'class', ownerId: cls?.id ?? '' })
      .returning();
    sessionId = session?.id ?? '';
  });
});

describe('attendance marks (one per source; the record is the winner)', () => {
  it('izin outranks the gate and the teacher, and its cancellation brings the next source back', async () => {
    const mark = (source: 'gate' | 'teacher' | 'leave', status: 'T' | 'A' | 'S', sourceRef?: string) => ({ sessionId, enrollmentId, source, status, sourceRef, recordedBy: null });
    await withTenant(tenant(), (tx) => changeMarks(tx, school, { write: [mark('gate', 'T')] }));
    expect(await current()).toEqual({ record: { status: 'T', source: 'gate' }, daily: 'T' });

    await withTenant(tenant(), (tx) => changeMarks(tx, school, { write: [mark('leave', 'S', leaveId)] }));
    const changes = await withTenant(tenant(), (tx) => changeMarks(tx, school, { write: [mark('teacher', 'A')] }));
    expect(changes).toEqual([]); // the izin still stands
    expect(await current()).toEqual({ record: { status: 'S', source: 'leave' }, daily: 'S' });
    expect(await alpaEvents()).toBe(0);

    const back = await withTenant(tenant(), (tx) => changeMarks(tx, school, { removeRef: { source: 'leave', sourceRef: leaveId } }));
    expect(back).toEqual([{ sessionId, enrollmentId, before: 'S', after: 'A' }]);
    expect(await current()).toEqual({ record: { status: 'A', source: 'teacher' }, daily: 'A' });
    expect(await alpaEvents()).toBe(1);
  });

  it('removing the last mark removes the record', async () => {
    await withTenant(tenant(), async (tx) => {
      await tx.delete(schema.attendanceMarks).where(and(eq(schema.attendanceMarks.sessionId, sessionId), eq(schema.attendanceMarks.source, 'teacher')));
      await tx.delete(schema.attendanceMarks).where(and(eq(schema.attendanceMarks.sessionId, sessionId), eq(schema.attendanceMarks.source, 'gate')));
      await changeMarks(tx, school, { write: [{ sessionId, enrollmentId, source: 'leave', status: 'I', sourceRef: leaveId, recordedBy: null }] });
    });
    await withTenant(tenant(), (tx) => changeMarks(tx, school, { removeRef: { source: 'leave', sourceRef: leaveId } }));
    expect((await current()).record).toBeNull();
  });
});
