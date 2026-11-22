import { schema } from '@absah/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/shared/db';
import { buildTestApp } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

let school: string;
let other: string;
let yearId: string;
let periodId: string;

const refusal = async (query: Promise<unknown>): Promise<string | null> => {
  try {
    await query;
    return null;
  } catch (err) {
    return (err as { cause?: { message?: string } }).cause?.message ?? String(err);
  }
};
const inSchool = <T>(schoolId: string, fn: Parameters<typeof withTenant<T>>[1]) => withTenant({ schoolId, userId: null }, fn);

beforeAll(async () => {
  school = await t.school('smp', 'SMP Ujian Skema');
  other = await t.school('smp', 'SMP Ujian Lain');
  await inSchool(school, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    yearId = year?.id ?? '';
    const [period] = await tx.insert(schema.examPeriods).values({ schoolId: school, academicYearId: yearId, name: 'PTS', startsOn: '2026-12-01', endsOn: '2026-12-05', minAttendance: 75 }).returning();
    periodId = period?.id ?? '';
  });
});

describe('exam_periods (UJN-01)', () => {
  it('is visible to its own school and to no other, and refuses a row for another school', async () => {
    expect(await inSchool(school, (tx) => tx.select().from(schema.examPeriods))).toHaveLength(1);
    expect(await inSchool(other, (tx) => tx.select().from(schema.examPeriods))).toHaveLength(0);
    expect(await refusal(inSchool(other, (tx) => tx.insert(schema.examPeriods).values({ schoolId: school, academicYearId: yearId, name: 'X', startsOn: '2026-12-01', endsOn: '2026-12-01' })))).toMatch(/row-level security/);
  });

  it('is never deleted, and only the columns the school edits can change', async () => {
    expect(await refusal(inSchool(school, (tx) => tx.execute(sql`delete from exam_periods`)))).toMatch(/permission denied/);
    expect(await refusal(inSchool(school, (tx) => tx.update(schema.examPeriods).set({ minAttendance: 80, closedAt: new Date() }).where(eq(schema.examPeriods.id, periodId))))).toBeNull();
    expect(await refusal(inSchool(school, (tx) => tx.update(schema.examPeriods).set({ academicYearId: crypto.randomUUID() }).where(eq(schema.examPeriods.id, periodId))))).toMatch(/permission denied/);
    expect(await refusal(inSchool(school, (tx) => tx.update(schema.examPeriods).set({ createdBy: null }).where(eq(schema.examPeriods.id, periodId))))).toMatch(/permission denied/);
  });

  it('keeps its dates and percent sane, and its name unique per year', async () => {
    const values = { schoolId: school, academicYearId: yearId, startsOn: '2026-12-01', endsOn: '2026-12-05' };
    expect(await refusal(inSchool(school, (tx) => tx.insert(schema.examPeriods).values({ ...values, name: 'Mundur', endsOn: '2026-11-30' })))).toMatch(/exam_periods_dates_check/);
    expect(await refusal(inSchool(school, (tx) => tx.insert(schema.examPeriods).values({ ...values, name: 'Nol', minAttendance: 0 })))).toMatch(/exam_periods_min_attendance_check/);
    expect(await refusal(inSchool(school, (tx) => tx.insert(schema.examPeriods).values({ ...values, name: 'PTS' })))).toMatch(/exam_periods_school_year_name_key/);
  });
});

describe('exam_rooms and exam_seats (UJN-03)', () => {
  let roomId: string;
  let otherRoomId: string;
  let otherPeriodId: string;
  let enrollmentId: string;

  beforeAll(async () => {
    await inSchool(school, async (tx) => {
      const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: yearId, name: '8A', grade: 8 }).returning();
      const [st] = await tx.insert(schema.students).values({ schoolId: school, name: 'Siswa Ruang' }).returning();
      const [en] = await tx.insert(schema.enrollments).values({ schoolId: school, studentId: st?.id ?? '', classId: cls?.id ?? '', academicYearId: yearId, startsOn: '2026-07-13' }).returning();
      enrollmentId = en?.id ?? '';
      const [p2] = await tx.insert(schema.examPeriods).values({ schoolId: school, academicYearId: yearId, name: 'PAS', startsOn: '2027-06-01', endsOn: '2027-06-05' }).returning();
      otherPeriodId = p2?.id ?? '';
      const [room, room2] = await tx.insert(schema.examRooms).values([{ schoolId: school, periodId, name: 'R1', capacity: 2 }, { schoolId: school, periodId: otherPeriodId, name: 'R1' }]).returning();
      roomId = room?.id ?? '';
      otherRoomId = room2?.id ?? '';
    });
  });

  it('are visible to their own school only, and a row for another school is refused', async () => {
    expect(await inSchool(school, (tx) => tx.select().from(schema.examRooms))).toHaveLength(2);
    expect(await inSchool(other, (tx) => tx.select().from(schema.examRooms))).toHaveLength(0);
    expect(await refusal(inSchool(other, (tx) => tx.insert(schema.examRooms).values({ schoolId: school, periodId, name: 'X' })))).toMatch(/row-level security/);
    expect(await refusal(inSchool(other, (tx) => tx.insert(schema.examSeats).values({ schoolId: school, periodId, roomId, enrollmentId, seatNo: 1 })))).toMatch(/row-level security/);
  });

  it('keep a student in one room per period, a seat number once per room, and a seat in a room of its own period', async () => {
    const seat = (room: string, period: string, no: number) => inSchool(school, (tx) => tx.insert(schema.examSeats).values({ schoolId: school, periodId: period, roomId: room, enrollmentId, seatNo: no }));
    expect(await refusal(seat(otherRoomId, periodId, 1))).toMatch(/exam_seats_room_period_fk/); // a room of another period
    expect(await refusal(seat(roomId, periodId, 1))).toBeNull();
    expect(await refusal(seat(roomId, periodId, 2))).toMatch(/exam_seats_period_enrollment_key/);
    expect(await refusal(seat(otherRoomId, otherPeriodId, 1))).toBeNull(); // another period: another seat
    expect(await refusal(inSchool(school, (tx) => tx.insert(schema.examRooms).values({ schoolId: school, periodId, name: 'R1' })))).toMatch(/exam_rooms_period_name_key/);
    expect(await refusal(inSchool(school, (tx) => tx.insert(schema.examRooms).values({ schoolId: school, periodId, name: 'Nol', capacity: 0 })))).toMatch(/exam_rooms_capacity_check/);
  });

  it('let a room’s details and a seat’s place change, and nothing else', async () => {
    expect(await refusal(inSchool(school, (tx) => tx.update(schema.examRooms).set({ name: 'Lab', capacity: 5 }).where(eq(schema.examRooms.id, roomId))))).toBeNull();
    expect(await refusal(inSchool(school, (tx) => tx.update(schema.examRooms).set({ periodId: otherPeriodId }).where(eq(schema.examRooms.id, roomId))))).toMatch(/permission denied/);
    expect(await refusal(inSchool(school, (tx) => tx.update(schema.examSeats).set({ seatNo: 9 }).where(eq(schema.examSeats.roomId, roomId))))).toBeNull();
    expect(await refusal(inSchool(school, (tx) => tx.update(schema.examSeats).set({ enrollmentId: crypto.randomUUID() }).where(eq(schema.examSeats.roomId, roomId))))).toMatch(/permission denied/);
    expect(await refusal(inSchool(school, (tx) => tx.execute(sql`truncate exam_seats`)))).toMatch(/permission denied/);
  });
});
