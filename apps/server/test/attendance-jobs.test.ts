import { schema } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { findSchool, generateDueSessions, generateForSchool, lockDueDays, remindUnfilled } from '../src/modules/attendance';
import { getDb, withPlatform, withTenant } from '../src/shared/db';
import { buildTestApp } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

// 2026-11-16 is a Monday. 05.00 is 21:00 UTC the day before in WITA (Makassar), 20:00 in WIT (Jayapura).
const MONDAY = '2026-11-16';
let sd: { school: string; classes: string[]; enrollments: string[]; teacher: string };
let smp: { school: string; teacher: string };

async function seedSchool(level: 'sd' | 'smp', name: string, timezone: string) {
  const school = await t.school(level, name);
  const teacher = await t.staff(`Guru ${name}`);
  await t.member(school, teacher.id, 'guru');
  await getDb().db.update(schema.schools).set({ timezone }).where(eq(schema.schools.id, school));
  return withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    if (!year) throw new Error('no year');
    const classes = await tx
      .insert(schema.classes)
      .values([
        { schoolId: school, academicYearId: year.id, name: `${level === 'sd' ? '1' : 'VII'} A`, grade: level === 'sd' ? 1 : 7, homeroomTeacherId: teacher.id },
        { schoolId: school, academicYearId: year.id, name: `${level === 'sd' ? '1' : 'VII'} B`, grade: level === 'sd' ? 1 : 7 },
      ])
      .returning();
    const students = await tx.insert(schema.students).values([{ schoolId: school, name: 'ANI' }, { schoolId: school, name: 'BUDI' }]).returning();
    const enrollments = await tx
      .insert(schema.enrollments)
      .values(students.map((s) => ({ schoolId: school, studentId: s.id, classId: classes[0]?.id ?? '', academicYearId: year.id, startsOn: '2026-07-13' })))
      .returning();
    return { school, teacher: teacher.id, yearId: year.id, classes: classes.map((c) => c.id), enrollments: enrollments.map((e) => e.id) };
  });
}

beforeAll(async () => {
  sd = await seedSchool('sd', 'SD Makassar', 'Asia/Makassar');
  const s = await seedSchool('smp', 'SMP Jayapura', 'Asia/Jayapura');
  smp = { school: s.school, teacher: s.teacher };
  await withTenant({ schoolId: s.school, userId: null }, async (tx) => {
    const [subject] = await tx.insert(schema.subjects).values({ schoolId: s.school, name: 'IPA' }).returning();
    await tx.insert(schema.schedulePeriods).values([
      { schoolId: s.school, day: 1, number: 1, startsAt: '07:00', endsAt: '07:40' },
      { schoolId: s.school, day: 1, number: 2, startsAt: '07:40', endsAt: '08:20' },
    ]);
    const slot = { schoolId: s.school, academicYearId: s.yearId, ownerType: 'class' as const, day: 1, subjectId: subject?.id ?? '' };
    await tx.insert(schema.scheduleSlots).values([
      { ...slot, ownerId: s.classes[0] ?? '', period: 1, teacherId: s.teacher },
      { ...slot, ownerId: s.classes[1] ?? '', period: 2, teacherId: null },
    ]);
  });
});

const forSchool = <T>(results: { schoolId: string; result: T }[], school: string) => results.find((r) => r.schoolId === school)?.result;
const sessionsOf = (school: string) =>
  withTenant({ schoolId: school, userId: null }, (tx) =>
    tx.select().from(schema.attendanceSessions).where(eq(schema.attendanceSessions.schoolDate, MONDAY)),
  );

describe('prs.generate-sessions', () => {
  it('runs at 05.00 on each school clock: Jayapura first, then Makassar', async () => {
    const early = await generateDueSessions(new Date('2026-11-15T20:30:00Z'));
    expect(forSchool(early, smp.school)).toEqual({ schoolDate: MONDAY, created: 2 });
    expect(forSchool(early, sd.school)).toBeUndefined();

    const later = await generateDueSessions(new Date('2026-11-15T21:05:00Z'));
    expect(forSchool(later, sd.school)).toEqual({ schoolDate: MONDAY, created: 2 });
    expect(forSchool(later, smp.school)).toBeUndefined(); // already done today
  });

  it('makes daily sessions per rombel for SD and lesson sessions for SMP', async () => {
    const daily = await sessionsOf(sd.school);
    expect(daily.map((s) => [s.mode, s.ownerType, s.slotId, s.teacherId]).sort()).toEqual([
      ['daily', 'class', null, null],
      ['daily', 'class', null, sd.teacher],
    ]);
    const lessons = await sessionsOf(smp.school);
    expect(lessons.every((s) => s.mode === 'per_period' && s.slotId !== null)).toBe(true);
  });

  it('skips holidays from the school calendar', async () => {
    await withTenant({ schoolId: sd.school, userId: null }, (tx) =>
      tx.insert(schema.calendarDays).values({ schoolId: sd.school, date: '2026-11-17', kind: 'holiday', name: 'Libur uji' }),
    );
    const result = await generateDueSessions(new Date('2026-11-16T21:10:00Z'));
    expect(forSchool(result, sd.school)).toEqual({ schoolDate: '2026-11-17', skipped: 'holiday' });
  });
});

describe('prs.remind-unfilled', () => {
  it('reminds the teacher 10 minutes after the lesson ends, once', async () => {
    // Lesson 1 ends 07.40 WIT = 22:40 UTC; reminder from 22:50 UTC.
    expect(forSchool(await remindUnfilled(new Date('2026-11-15T22:45:00Z')), smp.school)).toBeUndefined();
    expect(forSchool(await remindUnfilled(new Date('2026-11-15T22:55:00Z')), smp.school)).toEqual({ reminded: 1 });
    expect(forSchool(await remindUnfilled(new Date('2026-11-15T23:30:00Z')), smp.school)).toBeUndefined(); // lesson 2 has no teacher
    const events = await getDb()
      .db.select({ payload: schema.outboxEvents.payload })
      .from(schema.outboxEvents)
      .where(and(eq(schema.outboxEvents.schoolId, smp.school), eq(schema.outboxEvents.type, 'attendance.session_unfilled')));
    expect(events.map((e) => (e.payload as { teacherId: string }).teacherId)).toEqual([smp.teacher]);
  });
});

describe('prs.lock-sessions', () => {
  it('locks at 23.59 local time, marks unfilled sessions missed and computes daily attendance', async () => {
    const [filled] = (await sessionsOf(sd.school)).filter((s) => s.teacherId === sd.teacher);
    await withTenant({ schoolId: sd.school, userId: null }, async (tx) => {
      await tx.update(schema.attendanceSessions).set({ status: 'submitted' }).where(eq(schema.attendanceSessions.id, filled?.id ?? ''));
      await tx.insert(schema.attendanceRecords).values([
        { schoolId: sd.school, sessionId: filled?.id ?? '', enrollmentId: sd.enrollments[0] ?? '', status: 'H', source: 'teacher' },
        { schoolId: sd.school, sessionId: filled?.id ?? '', enrollmentId: sd.enrollments[1] ?? '', status: 'A', source: 'teacher' },
      ]);
    });

    // 14:59 UTC is 23:59 WIT (Jayapura) but only 22:59 WITA (Makassar).
    const jayapura = await lockDueDays(new Date('2026-11-16T14:59:00Z'));
    expect(forSchool(jayapura, smp.school)).toEqual([{ schoolDate: MONDAY, sessions: 2, missed: 2 }]);
    expect(forSchool(jayapura, sd.school)).toBeUndefined();
    expect(forSchool(await lockDueDays(new Date('2026-11-16T15:58:00Z')), sd.school)).toBeUndefined();
    const makassar = await lockDueDays(new Date('2026-11-16T15:59:00Z'));
    expect(forSchool(makassar, sd.school)).toEqual([{ schoolDate: MONDAY, sessions: 2, missed: 1 }]);

    const statuses = (await sessionsOf(sd.school)).map((s) => s.status).sort();
    expect(statuses).toEqual(['locked', 'missed']);
    const daily = await withTenant({ schoolId: sd.school, userId: null }, (tx) => tx.select().from(schema.dailyAttendance));
    expect(daily.map((d) => [d.enrollmentId, d.status]).sort()).toEqual(
      [
        [sd.enrollments[0], 'H'],
        [sd.enrollments[1], 'A'],
      ].sort(),
    );
    // Nothing left to lock; the 17th (holiday) waits for its own 23.59.
    expect(forSchool(await lockDueDays(new Date('2026-11-16T16:10:00Z')), sd.school)).toBeUndefined();
  });
});

describe('attendance:generate (ops)', () => {
  it('can force sessions on a non-school day and add sessions after a schedule change', async () => {
    const school = await withPlatform((tx) => findSchool(tx, sd.school));
    if (!school) throw new Error('no school');
    const sunday = '2026-11-22';
    expect(await generateForSchool(school, sunday, new Date())).toEqual({ schoolDate: sunday, skipped: 'not_school_day' });
    expect(await generateForSchool(school, sunday, new Date(), { force: true })).toEqual({ schoolDate: sunday, created: 2 });
    expect(await generateForSchool(school, sunday, new Date(), { force: true })).toEqual({ schoolDate: sunday, created: 0 });
  });
});
