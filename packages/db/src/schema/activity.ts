import { ACTIVITY_KINDS, ACTIVITY_LOCATIONS } from '@absah/contracts';
import { sql } from 'drizzle-orm';
import { boolean, check, date, index, pgEnum, pgTable, primaryKey, smallint, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { academicYears, enrollments } from './academic';
import { createdAt, id, schoolId } from './_shared';
import { user } from './auth';
import { schools } from './platform';

export const activityKind = pgEnum('activity_kind', ACTIVITY_KINDS);
export const activityLocation = pgEnum('activity_location', ACTIVITY_LOCATIONS);

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
