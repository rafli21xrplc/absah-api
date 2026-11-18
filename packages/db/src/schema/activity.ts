import { ACTIVITY_KINDS, ACTIVITY_LOCATIONS, KAIH_HABITS } from '@absah/contracts';
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, pgEnum, pgTable, primaryKey, smallint, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { academicYears, enrollments, students } from './academic';
import { createdAt, id, schoolId } from './_shared';
import { user } from './auth';
import { schools } from './platform';

export const activityKind = pgEnum('activity_kind', ACTIVITY_KINDS);
export const activityLocation = pgEnum('activity_location', ACTIVITY_LOCATIONS);
export const habitCode = pgEnum('habit_code', KAIH_HABITS);

const schoolRef = () => schoolId().references(() => schools.id, { onDelete: 'cascade' });

/**
 * Kegiatan (KEG-01) of one academic year. Attendance is not here: sessions with mode 'activity'
 * and activity_id live in attendance_sessions (CLAUDE.md rule 5), with their own rekap.
 */
export const activities = pgTable(
  'activities',
  {
    id: id(),
    schoolId: schoolRef(),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    kind: activityKind('kind').notNull(),
    location: activityLocation('location').notNull(),
    /** ISO weekdays (1 = Senin) it meets; sessions are generated on them. */
    days: smallint('days').array().notNull().default(sql`'{}'`),
    startsOn: date('starts_on'),
    endsOn: date('ends_on'),
    active: boolean('active').notNull().default(true),
    createdBy: uuid('created_by').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('activities_school_id_year_name_key').on(t.schoolId, t.academicYearId, t.name),
    check('activities_days_check', sql`${t.days} <@ array[1,2,3,4,5,6,7]::smallint[]`),
    check('activities_dates_check', sql`${t.startsOn} is null or ${t.endsOn} is null or ${t.startsOn} <= ${t.endsOn}`),
  ],
);

/** Pembina: staff who run the activity, take its attendance and manage its members. */
export const activityCoaches = pgTable(
  'activity_coaches',
  {
    schoolId: schoolRef(),
    activityId: uuid('activity_id')
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.activityId, t.userId] }), index('activity_coaches_school_id_user_id_idx').on(t.schoolId, t.userId)],
);

export const activityMembers = pgTable(
  'activity_members',
  {
    schoolId: schoolRef(),
    activityId: uuid('activity_id')
      .notNull()
      .references(() => activities.id, { onDelete: 'cascade' }),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.activityId, t.enrollmentId] }), index('activity_members_school_id_enrollment_id_idx').on(t.schoolId, t.enrollmentId)],
);

/**
 * Jurnal 7 KAIH (KEG-02): one row per enrollment, date and habit. filled_by_role says who ticked
 * (orang_tua or siswa, by habits.kaih). locked_at is set by keg.lock-habits once the date is more
 * than HABIT_EDIT_DAYS back; the API refuses such dates anyway.
 */
export const habitEntries = pgTable(
  'habit_entries',
  {
    id: id(),
    schoolId: schoolRef(),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    schoolDate: date('school_date').notNull(),
    habit: habitCode('habit').notNull(),
    value: boolean('value').notNull(),
    filledBy: uuid('filled_by').references(() => user.id, { onDelete: 'set null' }),
    filledByRole: text('filled_by_role').notNull(),
    lockedAt: timestamp('locked_at', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    unique('habit_entries_enrollment_id_school_date_habit_key').on(t.enrollmentId, t.schoolDate, t.habit),
    index('habit_entries_school_id_school_date_idx').on(t.schoolId, t.schoolDate),
    check('habit_entries_filled_by_role_check', sql`${t.filledByRole} in ('orang_tua', 'siswa')`),
  ],
);

/**
 * Setoran hafalan (KEG-03, religious.memorization): what a student recited to the guru tahfidz (the
 * listener). Per student, not per enrollment: hafalan carries over academic years.
 */
export const memorizationLogs = pgTable(
  'memorization_logs',
  {
    id: id(),
    schoolId: schoolRef(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    schoolDate: date('school_date').notNull(),
    surah: smallint('surah').notNull(),
    juz: smallint('juz'),
    ayatFrom: smallint('ayat_from').notNull(),
    ayatTo: smallint('ayat_to').notNull(),
    score: smallint('score'),
    note: text('note'),
    listenerId: uuid('listener_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    index('memorization_logs_school_id_student_id_school_date_idx').on(t.schoolId, t.studentId, t.schoolDate),
    check('memorization_logs_surah_check', sql`${t.surah} between 1 and 114`),
    check('memorization_logs_juz_check', sql`${t.juz} is null or ${t.juz} between 1 and 30`),
    check('memorization_logs_ayat_check', sql`${t.ayatFrom} >= 1 and ${t.ayatTo} >= ${t.ayatFrom}`),
    check('memorization_logs_score_check', sql`${t.score} is null or ${t.score} between 0 and 100`),
  ],
);
