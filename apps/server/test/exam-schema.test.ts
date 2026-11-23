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
