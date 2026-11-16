import { schema } from '@absah/db';
import { afterAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/shared/db';
import { buildTestApp } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

async function seed(name: string) {
  const school = await t.school('sd', name);
  return withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    if (!year) throw new Error('no year');
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year.id, name: '1A', grade: 1 }).returning();
    const [student] = await tx.insert(schema.students).values({ schoolId: school, name: 'ANI' }).returning();
    if (!cls || !student) throw new Error('seed failed');
    const [enrollment] = await tx
      .insert(schema.enrollments)
      .values({ schoolId: school, studentId: student.id, classId: cls.id, academicYearId: year.id, startsOn: '2026-07-13' })
      .returning();
    const [session] = await tx
      .insert(schema.attendanceSessions)
      .values({ schoolId: school, schoolDate: '2026-11-16', mode: 'daily', ownerType: 'class', ownerId: cls.id })
      .returning();
    if (!enrollment || !session) throw new Error('seed failed');
    await tx.insert(schema.attendanceRecords).values({ schoolId: school, sessionId: session.id, enrollmentId: enrollment.id, status: 'H', source: 'teacher' });
    await tx.insert(schema.dailyAttendance).values({ schoolId: school, enrollmentId: enrollment.id, schoolDate: '2026-11-16', status: 'H' });
    await tx.insert(schema.correctionRequests).values({ schoolId: school, sessionId: session.id, enrollmentId: enrollment.id, toStatus: 'S', reason: 'Surat dokter' });
    await tx.insert(schema.attendanceDays).values({ schoolId: school, schoolDate: '2026-11-16', generatedAt: new Date() });
    return { school, classId: cls.id, sessionId: session.id, enrollmentId: enrollment.id };
  });
}

describe('attendance tables', () => {
  it('are isolated per school', async () => {
    const one = await seed('SD Presensi 1');
    const two = await seed('SD Presensi 2');
    await withTenant({ schoolId: two.school, userId: null }, async (tx) => {
      for (const table of [schema.attendanceSessions, schema.attendanceRecords, schema.dailyAttendance, schema.correctionRequests, schema.attendanceDays]) {
        const rows = await tx.select({ schoolId: table.schoolId }).from(table);
        expect(rows.map((r) => r.schoolId)).toEqual([two.school]);
      }
    });
    await expect(
      withTenant({ schoolId: two.school, userId: null }, (tx) =>
        tx.insert(schema.attendanceSessions).values({ schoolId: one.school, schoolDate: '2026-11-17', mode: 'daily', ownerType: 'class', ownerId: one.classId }),
      ),
    ).rejects.toThrow();
  });

  it('keep one daily session per rombel per day, one record per student per session, one pending correction', async () => {
    const s = await seed('SD Presensi Unik');
    const scope = { schoolId: s.school, userId: null };
    await expect(
      withTenant(scope, (tx) => tx.insert(schema.attendanceSessions).values({ schoolId: s.school, schoolDate: '2026-11-16', mode: 'daily', ownerType: 'class', ownerId: s.classId })),
    ).rejects.toThrow();
    await expect(
      withTenant(scope, (tx) => tx.insert(schema.attendanceRecords).values({ schoolId: s.school, sessionId: s.sessionId, enrollmentId: s.enrollmentId, status: 'A', source: 'gate' })),
    ).rejects.toThrow();
    await expect(
      withTenant(scope, (tx) => tx.insert(schema.correctionRequests).values({ schoolId: s.school, sessionId: s.sessionId, enrollmentId: s.enrollmentId, toStatus: 'I', reason: 'Lagi' })),
    ).rejects.toThrow();
  });
});
