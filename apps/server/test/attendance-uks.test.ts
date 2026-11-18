import { schema, sensitive } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { attendanceConsumers, findSchool } from '../src/modules/attendance';
import { applyUksToDate } from '../src/modules/attendance/application/uks-marks';
import { getDb, withPlatform, withTenant } from '../src/shared/db';
import { runConsumer } from '../src/shared/outbox';
import { schoolDate } from '../src/shared/school-date';
import { buildTestApp } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

const today = schoolDate('Asia/Jakarta');
const weekday = ((new Date(`${today}T00:00:00Z`).getUTCDay() + 6) % 7) + 1; // ISO 1-7
/** 07.50 on the school clock (WIB = UTC+7): lesson 1 (07.00-07.40) is over, lessons 2 and 3 are not. */
const AT_0750 = new Date(`${today}T00:50:00Z`);

let school: string;
let students: Record<string, string>;
let sessions: Record<string, string>; // label -> session id
let classId: string;
let teacher: string;

async function addVisit(name: string, outcome: 'dipulangkan' | 'istirahat', visitedAt = AT_0750): Promise<string> {
  const id = uuidv7();
  await withTenant({ schoolId: school, userId: null }, (tx) =>
    tx.insert(schema.uksVisits).values({ id, schoolId: school, enrollmentId: students[name] ?? '', schoolDate: today, visitedAt, complaint: sensitive('Demam'), outcome }),
  );
  return id;
}

async function deliver(uksVisitId: string) {
  const consumer = attendanceConsumers().find((c) => c.event === 'uks.sent_home');
  if (!consumer) throw new Error('no consumer for uks.sent_home');
  return runConsumer(consumer, { id: uuidv7(), schoolId: school, type: 'uks.sent_home', payload: { uksVisitId }, traceId: null, occurredAt: new Date().toISOString() });
}

/** status:source per lesson label for one student. */
async function recordsOf(name: string) {
  const rows = await getDb()
    .db.select({ sessionId: schema.attendanceRecords.sessionId, status: schema.attendanceRecords.status, source: schema.attendanceRecords.source })
    .from(schema.attendanceRecords)
    .where(eq(schema.attendanceRecords.enrollmentId, students[name] ?? ''));
  return Object.fromEntries(Object.entries(sessions).map(([label, id]) => [label, rows.find((r) => r.sessionId === id) ? `${rows.find((r) => r.sessionId === id)?.status}:${rows.find((r) => r.sessionId === id)?.source}` : null]));
}

beforeAll(async () => {
  school = await t.school('smp', 'SMP UKS Absensi');
  teacher = (await t.staff('Guru Mapel UKS')).id;
  await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year?.id ?? '', name: '9A', grade: 9 }).returning();
    classId = cls?.id ?? '';
    const rows = await tx.insert(schema.students).values(['ANI', 'BUDI', 'CITRA'].map((name) => ({ schoolId: school, name }))).returning();
    const enrolled = await tx
      .insert(schema.enrollments)
      .values(rows.map((s) => ({ schoolId: school, studentId: s.id, classId, academicYearId: year?.id ?? '', startsOn: '2026-07-13' })))
      .returning();
    students = Object.fromEntries(rows.map((s, i) => [s.name, enrolled[i]?.id ?? '']));
    const [subject] = await tx.insert(schema.subjects).values({ schoolId: school, name: 'IPA' }).returning();
    await tx.insert(schema.schedulePeriods).values([
      { schoolId: school, day: weekday, number: 1, startsAt: '07:00', endsAt: '07:40' },
      { schoolId: school, day: weekday, number: 2, startsAt: '07:40', endsAt: '08:20' },
      { schoolId: school, day: weekday, number: 3, startsAt: '08:20', endsAt: '09:00' },
    ]);
    const slot = { schoolId: school, academicYearId: year?.id ?? '', ownerType: 'class' as const, ownerId: classId, day: weekday, subjectId: subject?.id ?? '' };
    const slots = await tx.insert(schema.scheduleSlots).values([1, 2, 3].map((period) => ({ ...slot, period }))).returning();
    const made = await tx
      .insert(schema.attendanceSessions)
      .values(slots.map((s) => ({ schoolId: school, schoolDate: today, mode: 'per_period' as const, ownerType: 'class' as const, ownerId: classId, slotId: s.id, teacherId: teacher })))
      .returning();
    const byPeriod = (n: number) => made.find((m) => m.slotId === slots.find((s) => s.period === n)?.id)?.id ?? '';
    sessions = { lesson1: byPeriod(1), lesson2: byPeriod(2), lesson3: byPeriod(3) };
    // The teacher already said ANI and BUDI were present in lesson 1 and lesson 3; CITRA was marked alpa in lesson 3.
    const marks = [
      { sessionId: sessions.lesson1 ?? '', enrollmentId: students.ANI ?? '', status: 'H' as const, source: 'teacher' as const },
      { sessionId: sessions.lesson3 ?? '', enrollmentId: students.ANI ?? '', status: 'H' as const, source: 'teacher' as const },
      { sessionId: sessions.lesson3 ?? '', enrollmentId: students.CITRA ?? '', status: 'A' as const, source: 'teacher' as const },
      // BUDI has an approved izin in lesson 3 (written by the leave module): it outranks UKS.
      { sessionId: sessions.lesson3 ?? '', enrollmentId: students.BUDI ?? '', status: 'I' as const, source: 'leave' as const },
    ].map((m) => ({ schoolId: school, ...m }));
    await tx.insert(schema.attendanceMarks).values(marks);
    await tx.insert(schema.attendanceRecords).values(marks);
  });
});

describe('uks.sent_home marks the rest of the day sakit (UKS -> PRS)', () => {
  let visit: string;

  it('marks the lessons that had not ended, over the teacher, and leaves earlier lessons alone', async () => {
    visit = await addVisit('ANI', 'dipulangkan');
    expect(await deliver(visit)).toBe('handled');
    expect(await recordsOf('ANI')).toEqual({ lesson1: 'H:teacher', lesson2: 'S:uks', lesson3: 'S:uks' });
    const daily = await getDb()
      .db.select({ status: schema.dailyAttendance.status })
      .from(schema.dailyAttendance)
      .where(and(eq(schema.dailyAttendance.enrollmentId, students.ANI ?? ''), eq(schema.dailyAttendance.schoolDate, today)));
    expect(daily).toEqual([{ status: 'H' }]); // present in lesson 1, so the day stays H
  });

  it('is the same after a redelivery, and the teacher cannot overwrite it', async () => {
    expect(await deliver(visit)).toBe('handled');
    expect(await recordsOf('ANI')).toEqual({ lesson1: 'H:teacher', lesson2: 'S:uks', lesson3: 'S:uks' });
  });

  it('does not override an approved izin, and ignores visits that did not send the student home', async () => {
    const budi = await addVisit('BUDI', 'dipulangkan');
    await deliver(budi);
    expect(await recordsOf('BUDI')).toEqual({ lesson1: null, lesson2: 'S:uks', lesson3: 'I:leave' });
    const rest = await addVisit('CITRA', 'istirahat');
    await deliver(rest);
    expect(await recordsOf('CITRA')).toEqual({ lesson1: null, lesson2: null, lesson3: 'A:teacher' });
  });

  it('counts the whole day when the visit came before the first lesson', async () => {
    const early = await addVisit('CITRA', 'dipulangkan', new Date(`${today}T00:10:00Z`)); // 07.10
    await deliver(early);
    expect(await recordsOf('CITRA')).toEqual({ lesson1: 'S:uks', lesson2: 'S:uks', lesson3: 'S:uks' });
  });

  it('gives sessions created later the same day the visits already recorded', async () => {
    const extra = await withTenant({ schoolId: school, userId: null }, async (tx) => {
      const [group] = await tx.insert(schema.attendanceSessions).values({ schoolId: school, schoolDate: today, mode: 'daily', ownerType: 'class', ownerId: classId, teacherId: teacher }).returning();
      return group?.id ?? '';
    });
    sessions.daily = extra;
    const school_ = await withPlatform((tx) => findSchool(tx, school));
    expect(school_?.timezone).toBe('Asia/Jakarta');
    await withTenant({ schoolId: school, userId: null }, (tx) => applyUksToDate(tx, school, today));
    expect((await recordsOf('ANI')).daily).toBe('S:uks');
    expect((await recordsOf('CITRA')).daily).toBe('S:uks');
    expect((await recordsOf('BUDI')).daily).toBe('S:uks');
  });
});
