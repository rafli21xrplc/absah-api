import { schema, SensitiveText } from '@absah/db';
import { eq, sql } from 'drizzle-orm';
import { afterAll, describe, expect, it } from 'vitest';
import { hashValue } from '../src/shared/crypto';
import { getDb, withTenant } from '../src/shared/db';
import { buildTestApp } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

const NIK = '3201010101100001';

/** One school with a year, a class, a student (with NIK), an enrollment, a guardian and consent. */
async function seed(name: string) {
  const school = await t.school('smp', name);
  const ids = await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx
      .insert(schema.academicYears)
      .values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-13', endsOn: '2027-06-30', isActive: true })
      .returning();
    if (!year) throw new Error('no year');
    await tx.insert(schema.semesters).values([
      { schoolId: school, academicYearId: year.id, number: 1, startsOn: '2026-07-13', endsOn: '2026-12-19' },
      { schoolId: school, academicYearId: year.id, number: 2, startsOn: '2027-01-04', endsOn: '2027-06-30' },
    ]);
    await tx.insert(schema.calendarDays).values({ schoolId: school, date: '2026-08-17', kind: 'holiday', name: 'HUT RI' });
    const [cls] = await tx.insert(schema.classes).values({ schoolId: school, academicYearId: year.id, name: 'VII A', grade: 7 }).returning();
    const [student] = await tx
      .insert(schema.students)
      .values({ schoolId: school, name: 'Siswa Uji', nisn: '0123456789', nik: new SensitiveText(NIK), nikHash: hashValue(NIK), birthDate: '2013-05-14', gender: 'P' })
      .returning();
    if (!cls || !student) throw new Error('no class/student');
    await tx.insert(schema.enrollments).values({ schoolId: school, studentId: student.id, classId: cls.id, academicYearId: year.id, startsOn: '2026-07-13' });
    const [guardian] = await tx.insert(schema.guardians).values({ schoolId: school, name: 'Ibu Uji', phone: new SensitiveText('+6281200000009'), phoneHash: hashValue('+6281200000009') }).returning();
    if (!guardian) throw new Error('no guardian');
    await tx.insert(schema.studentGuardians).values({ schoolId: school, studentId: student.id, guardianId: guardian.id, relation: 'ibu', isPrimary: true });
    await tx.insert(schema.consents).values({ schoolId: school, studentId: student.id, guardianId: guardian.id, purpose: 'data_processing', method: 'paper', grantedAt: new Date() });
    return { year: year.id, cls: cls.id, student: student.id };
  });
  return { school, ...ids };
}

const TABLES = [
  schema.academicYears,
  schema.semesters,
  schema.calendarDays,
  schema.classes,
  schema.students,
  schema.enrollments,
  schema.guardians,
  schema.studentGuardians,
  schema.consents,
] as const;

describe('academic tables', () => {
  it('are isolated per school by RLS', async () => {
    const a = await seed('SMP A');
    const b = await seed('SMP B');
    await withTenant({ schoolId: b.school, userId: null }, async (tx) => {
      for (const table of TABLES) {
        const rows = await tx.select({ schoolId: table.schoolId }).from(table);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.schoolId === b.school)).toBe(true);
      }
    });
    // Writing a row for another school is refused by WITH CHECK.
    await expect(
      withTenant({ schoolId: b.school, userId: null }, (tx) =>
        tx.insert(schema.students).values({ schoolId: a.school, name: 'Penyusup' }),
      ),
    ).rejects.toThrow();
  });

  it('store NIK and guardian phone encrypted and read them back', async () => {
    const s = await seed('SMP Enkripsi');
    const raw = await getDb().db.execute<{ nik: string }>(sql`select nik from students where id = ${s.student}`); // owner read, test only
    expect(raw.rows[0]?.nik).not.toContain(NIK);
    const [row] = await withTenant({ schoolId: s.school, userId: null }, (tx) =>
      tx.select().from(schema.students).where(eq(schema.students.id, s.student)),
    );
    expect(row?.nik?.reveal()).toBe(NIK);
  });

  it('keep NISN unique and well-formed, and one active enrollment per student per year', async () => {
    const s = await seed('SMP Unik');
    const scope = { schoolId: s.school, userId: null };
    await expect(withTenant(scope, (tx) => tx.insert(schema.students).values({ schoolId: s.school, name: 'Kembar', nisn: '0123456789' }))).rejects.toThrow();
    await expect(withTenant(scope, (tx) => tx.insert(schema.students).values({ schoolId: s.school, name: 'Salah', nisn: '12345' }))).rejects.toThrow();
    await expect(
      withTenant(scope, (tx) =>
        tx.insert(schema.enrollments).values({ schoolId: s.school, studentId: s.student, classId: s.cls, academicYearId: s.year, startsOn: '2026-08-01' }),
      ),
    ).rejects.toThrow();
    // A finished enrollment does not block a new active one.
    await withTenant(scope, async (tx) => {
      await tx.update(schema.enrollments).set({ status: 'moved', endsOn: '2026-07-31' }).where(eq(schema.enrollments.studentId, s.student));
      await tx.insert(schema.enrollments).values({ schoolId: s.school, studentId: s.student, classId: s.cls, academicYearId: s.year, startsOn: '2026-08-01' });
    });
  });
});
