import type { AttendanceStatus } from '@absah/contracts';
import { schema, sensitive, type Tx } from '@absah/db';
import { and, asc, eq, gte, isNull, lte, or, sql } from 'drizzle-orm';

const c = schema.classes;
const e = schema.enrollments;
const d = schema.dailyAttendance;
const m = schema.mbgDailyCounts;
const settings = schema.mbgSettings;

export async function mbgSettingsOf(tx: Tx) {
  const [row] = await tx.select().from(settings);
  return row ?? null;
}

export async function saveMbgSettings(tx: Tx, schoolId: string, values: { cutoffTime: string; picName: string | null; picPhone: string | null; updatedBy: string }, now: Date) {
  const set = { cutoffTime: values.cutoffTime, picName: values.picName, picPhone: values.picPhone ? sensitive(values.picPhone) : null, updatedBy: values.updatedBy, updatedAt: now };
  await tx.insert(settings).values({ schoolId, ...set }).onConflictDoUpdate({ target: settings.schoolId, set });
}

export async function schoolTimezone(tx: Tx, schoolId: string): Promise<string> {
  const [row] = await tx.select({ timezone: schema.schools.timezone }).from(schema.schools).where(eq(schema.schools.id, schoolId));
  return row?.timezone ?? 'Asia/Jakarta';
}

/** The PRS job marker of the date: generated (school day) or skipped (holiday, weekend). */
export async function attendanceDay(tx: Tx, date: string) {
  const day = schema.attendanceDays;
  const [row] = await tx.select({ generatedAt: day.generatedAt, skippedReason: day.skippedReason }).from(day).where(eq(day.schoolDate, date));
  return row ?? null;
}

/** Rombel of the active year. */
export function mbgClasses(tx: Tx) {
  return tx
    .select({ classId: c.id, name: c.name })
    .from(c)
    .innerJoin(schema.academicYears, and(eq(schema.academicYears.id, c.academicYearId), eq(schema.academicYears.isActive, true)))
    .orderBy(asc(c.grade), asc(c.name));
}

/** Students enrolled on the date in a rombel of the active year, with their rekap status that day. */
export function enrolledWithStatus(tx: Tx, date: string): Promise<{ classId: string; status: AttendanceStatus | null }[]> {
  return tx
    .select({ classId: e.classId, status: d.status })
    .from(e)
    .innerJoin(schema.academicYears, and(eq(schema.academicYears.id, e.academicYearId), eq(schema.academicYears.isActive, true)))
    .leftJoin(d, and(eq(d.enrollmentId, e.id), eq(d.schoolDate, date)))
    .where(and(lte(e.startsOn, date), or(isNull(e.endsOn), gte(e.endsOn, date))));
}

/** Current rows of the date: the ones no other row supersedes (the latest correction per rombel). */
export function currentCounts(tx: Tx, date: string) {
  return tx
    .select({
      id: m.id,
      classId: m.classId,
      name: c.name,
      enrolled: m.enrolled,
      present: m.presentAtCutoff,
      unrecorded: m.unrecorded,
      sentAt: m.sentAt,
      corrected: m.supersedesId,
      createdAt: m.createdAt,
    })
    .from(m)
    .innerJoin(c, eq(c.id, m.classId))
    .where(and(eq(m.schoolDate, date), sql`not exists (select 1 from mbg_daily_counts newer where newer.supersedes_id = ${m.id})`))
    .orderBy(asc(c.grade), asc(c.name));
}

/** The cutoff rows of the date (first count, before any correction). */
export function cutoffRows(tx: Tx, date: string) {
  return tx
    .select({ createdAt: m.createdAt, sentAt: m.sentAt })
    .from(m)
    .where(and(eq(m.schoolDate, date), isNull(m.supersedesId)))
    .orderBy(asc(m.createdAt))
    .limit(1);
}
