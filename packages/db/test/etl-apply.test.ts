import { readFileSync } from 'node:fs';
import { eq } from 'drizzle-orm';
import { uuidv7 } from 'uuidv7';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { applyEtl, EtlError, existingNisns } from '../etl/apply';
import { readDump } from '../etl/mysql-dump';
import { LEGACY_TABLES, mapProjectAttendance } from '../etl/project-attendance';
import type { DbHandle } from '../src/client';
import { academicYears, classes, enrollments, schools, students } from '../src/schema';
import { withTenant } from '../src/tenant';
import { testDb } from './helpers';

let h: DbHandle;
const school = uuidv7();
const empty = uuidv7();
const tables = readDump(readFileSync(new URL('../fixtures/project-attendance/dump.sql', import.meta.url), 'utf8'), LEGACY_TABLES);

beforeAll(async () => {
  h = testDb();
  await h.db.insert(schools).values([
    { id: school, name: 'SMA ETL', level: 'sma' },
    { id: empty, name: 'SMA ETL Kosong', level: 'sma' },
  ]);
  const yearId = uuidv7();
  await h.db.insert(academicYears).values({ id: yearId, schoolId: school, name: '2026/2027', startsOn: '2026-07-13', endsOn: '2027-06-25', isActive: true });
  // Already in Absah (e.g. a Dapodik import): one rombel and one student.
  const classId = uuidv7();
  await h.db.insert(classes).values({ id: classId, schoolId: school, academicYearId: yearId, name: 'X IPA 1', grade: 10 });
  const [s] = await h.db.insert(students).values({ schoolId: school, name: 'SUDAH DI ABSAH', nisn: '9913100009' }).returning();
  await h.db.insert(enrollments).values({ schoolId: school, studentId: s?.id ?? '', classId, academicYearId: yearId, startsOn: '2026-07-13' });
});
afterAll(async () => {
  await h.db.delete(schools).where(eq(schools.id, school));
  await h.db.delete(schools).where(eq(schools.id, empty));
  await h.close();
});

describe('applyEtl', () => {
  it('writes missing rombel, new students and their enrollment into the active year, once', async () => {
    const plan = mapProjectAttendance(tables, { yearStartsOn: '2026-07-13', existingNisns: await existingNisns(h.db, school) });
    expect(plan.skipped.existing).toBe(1);
    expect(await applyEtl(h.db, school, plan)).toEqual({ classesCreated: 1, studentsCreated: 4 });
    // Applying the same plan again (e.g. a retry) adds nothing.
    expect(await applyEtl(h.db, school, plan)).toEqual({ classesCreated: 0, studentsCreated: 0 });

    const rows = await withTenant(h.db, { schoolId: school, userId: null }, (tx) =>
      tx.select({ nisn: students.nisn, cls: classes.name, startsOn: enrollments.startsOn, status: enrollments.status }).from(enrollments).innerJoin(students, eq(students.id, enrollments.studentId)).innerJoin(classes, eq(classes.id, enrollments.classId)),
    );
    expect(rows.map((r) => [r.nisn, r.cls, r.startsOn, r.status]).sort()).toEqual([
      ['0991310001', 'X IPA 1', '2026-07-13', 'active'],
      ['9913100002', 'X IPA 1', '2026-07-13', 'active'],
      ['9913100003', 'XI IPS 1', '2026-07-13', 'active'],
      ['9913100008', 'XI IPS 1', '2026-09-01', 'active'],
      ['9913100009', 'X IPA 1', '2026-07-13', 'active'],
    ]);
  });

  it('refuses a school without an active academic year', async () => {
    const plan = mapProjectAttendance(tables, { yearStartsOn: '2026-07-13', existingNisns: new Set() });
    await expect(applyEtl(h.db, empty, plan)).rejects.toBeInstanceOf(EtlError);
  });
});
