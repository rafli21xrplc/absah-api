import { schema } from '@absah/db';
import { afterAll, describe, expect, it } from 'vitest';
import { withTenant } from '../src/shared/db';
import { buildTestApp } from './harness';

const t = buildTestApp();
afterAll(() => t.cleanup());

async function seed(name: string) {
  const school = await t.school('sma', name);
  const teacher = await t.staff(`Guru ${name}`);
  await t.member(school, teacher.id, 'guru');
  const ids = await withTenant({ schoolId: school, userId: null }, async (tx) => {
    const [year] = await tx.insert(schema.academicYears).values({ schoolId: school, name: '2026/2027', startsOn: '2026-07-01', endsOn: '2027-06-30', isActive: true }).returning();
    if (!year) throw new Error('no year');
    const [a, b] = await tx
      .insert(schema.classes)
      .values([
        { schoolId: school, academicYearId: year.id, name: 'X 1', grade: 10 },
        { schoolId: school, academicYearId: year.id, name: 'X 2', grade: 10 },
      ])
      .returning();
    const [subject] = await tx.insert(schema.subjects).values({ schoolId: school, name: 'Matematika' }).returning();
    if (!a || !b || !subject) throw new Error('seed failed');
    await tx.insert(schema.schedulePeriods).values({ schoolId: school, day: 1, number: 1, startsAt: '07:00', endsAt: '07:45' });
    const [group] = await tx.insert(schema.learningGroups).values({ schoolId: school, academicYearId: year.id, subjectId: subject.id, name: 'Informatika A' }).returning();
    if (!group) throw new Error('no group');
    await tx.insert(schema.scheduleSlots).values({ schoolId: school, academicYearId: year.id, ownerType: 'class', ownerId: a.id, day: 1, period: 1, subjectId: subject.id, teacherId: teacher.id });
    return { year: year.id, a: a.id, b: b.id, subject: subject.id };
  });
  return { school, teacher: teacher.id, ...ids };
}

describe('schedule tables', () => {
  it('are isolated per school', async () => {
    const one = await seed('SMA Jadwal 1');
    const two = await seed('SMA Jadwal 2');
    await withTenant({ schoolId: two.school, userId: null }, async (tx) => {
      for (const table of [schema.subjects, schema.schedulePeriods, schema.learningGroups, schema.scheduleSlots]) {
        const rows = await tx.select({ schoolId: table.schoolId }).from(table);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.schoolId === two.school)).toBe(true);
      }
    });
    await expect(
      withTenant({ schoolId: two.school, userId: null }, (tx) => tx.insert(schema.subjects).values({ schoolId: one.school, name: 'Penyusup' })),
    ).rejects.toThrow();
  });

  it('refuse a teacher or a rombel in two slots at the same time', async () => {
    const s = await seed('SMA Bentrok');
    const scope = { schoolId: s.school, userId: null };
    const slot = { schoolId: s.school, academicYearId: s.year, day: 1, period: 1, subjectId: s.subject };
    await expect(withTenant(scope, (tx) => tx.insert(schema.scheduleSlots).values({ ...slot, ownerType: 'class', ownerId: s.b, teacherId: s.teacher }))).rejects.toThrow();
    await expect(withTenant(scope, (tx) => tx.insert(schema.scheduleSlots).values({ ...slot, ownerType: 'class', ownerId: s.a, teacherId: null }))).rejects.toThrow();
    // Another rombel without a teacher at the same time is fine.
    await withTenant(scope, (tx) => tx.insert(schema.scheduleSlots).values({ ...slot, ownerType: 'class', ownerId: s.b, teacherId: null }));
  });
});
