import { sql } from 'drizzle-orm';
import { boolean, check, date, index, pgTable, smallint, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { academicYears } from './academic';
import { createdAt, id, schoolId } from './_shared';
import { user } from './auth';
import { schools } from './platform';

/**
 * An exam period (UJN-01/02): a named stretch of dates in an academic year with the rule the school chose for who may sit it.
 * The rule is minimum attendance (percent of the days with a record from attendance_from to the start of the period, null =
 * no attendance rule) and/or bills paid (installments due on or before the start of the period, of the listed fee types, or
 * of every fee type when the list is empty). Whether a student may sit is computed from live data each time, never stored,
 * so it changes the moment a bill is paid. closed_at ends a period without deleting it.
 */
export const examPeriods = pgTable(
  'exam_periods',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    minAttendance: smallint('min_attendance'),
    /** First day counted for attendance; null = the academic year's first day. */
    attendanceFrom: date('attendance_from'),
    /** Sakit and izin count as present for the attendance rule (a student with a letter is not punished); alpa never does. */
    excusedCounts: boolean('excused_counts').notNull().default(true),
    requirePaid: boolean('require_paid').notNull().default(false),
    feeTypeIds: uuid('fee_type_ids').array().notNull().default(sql`'{}'::uuid[]`),
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('exam_periods_school_year_name_key').on(t.schoolId, t.academicYearId, t.name),
    index('exam_periods_school_id_starts_on_idx').on(t.schoolId, t.startsOn),
    check('exam_periods_dates_check', sql`${t.endsOn} >= ${t.startsOn}`),
    check('exam_periods_min_attendance_check', sql`${t.minAttendance} is null or (${t.minAttendance} between 1 and 100)`),
  ],
);
