import { SLOT_OWNER_TYPES } from '@absah/contracts';
import { sql } from 'drizzle-orm';
import { check, index, pgEnum, pgTable, primaryKey, smallint, text, time, unique, uniqueIndex, uuid } from 'drizzle-orm/pg-core';
import { academicYears, enrollments } from './academic';
import { createdAt, id, schoolId } from './_shared';
import { user } from './auth';
import { schools } from './platform';

export const slotOwnerType = pgEnum('slot_owner_type', SLOT_OWNER_TYPES);

const schoolRef = () => schoolId().references(() => schools.id, { onDelete: 'cascade' });
const yearRef = () =>
  uuid('academic_year_id')
    .notNull()
    .references(() => academicYears.id, { onDelete: 'cascade' });
const dayCheck = (name: string, column: unknown) => check(name, sql`${column} between 1 and 7`);

/** Mata pelajaran. */
export const subjects = pgTable(
  'subjects',
  {
    id: id(),
    schoolId: schoolRef(),
    name: text('name').notNull(),
    code: text('code'),
    createdAt: createdAt(),
  },
  (t) => [unique('subjects_school_id_name_key').on(t.schoolId, t.name)],
);

/** Jam pelajaran ke-n per weekday (Friday is often shorter). Slots refer to (day, number). */
export const schedulePeriods = pgTable(
  'schedule_periods',
  {
    schoolId: schoolRef(),
    day: smallint('day').notNull(),
    number: smallint('number').notNull(),
    startsAt: time('starts_at').notNull(),
    endsAt: time('ends_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.schoolId, t.day, t.number] }),
    dayCheck('schedule_periods_day_check', t.day),
    check('schedule_periods_number_check', sql`${t.number} between 0 and 20`),
    check('schedule_periods_time_check', sql`${t.startsAt} < ${t.endsAt}`),
  ],
);

/** Mapel pilihan / moving class across rombel (AKD-10). */
export const learningGroups = pgTable(
  'learning_groups',
  {
    id: id(),
    schoolId: schoolRef(),
    academicYearId: yearRef(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'restrict' }),
    teacherId: uuid('teacher_id').references(() => user.id, { onDelete: 'set null' }),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [unique('learning_groups_school_id_year_name_key').on(t.schoolId, t.academicYearId, t.name)],
);

export const learningGroupMembers = pgTable(
  'learning_group_members',
  {
    schoolId: schoolRef(),
    learningGroupId: uuid('learning_group_id')
      .notNull()
      .references(() => learningGroups.id, { onDelete: 'cascade' }),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.learningGroupId, t.enrollmentId] }),
    index('learning_group_members_school_id_enrollment_id_idx').on(t.schoolId, t.enrollmentId),
  ],
);

/**
 * One lesson in the weekly timetable. owner_type/owner_id point at a rombel (classes) or a
 * learning group. A teacher cannot be in two slots at the same time (unique index); a student in
 * two slots at once (via rombel and group) is checked by the application.
 */
export const scheduleSlots = pgTable(
  'schedule_slots',
  {
    id: id(),
    schoolId: schoolRef(),
    academicYearId: yearRef(),
    ownerType: slotOwnerType('owner_type').notNull(),
    ownerId: uuid('owner_id').notNull(),
    day: smallint('day').notNull(),
    period: smallint('period').notNull(),
    subjectId: uuid('subject_id')
      .notNull()
      .references(() => subjects.id, { onDelete: 'restrict' }),
    teacherId: uuid('teacher_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('schedule_slots_owner_time_key').on(t.ownerType, t.ownerId, t.day, t.period),
    uniqueIndex('schedule_slots_teacher_time_key')
      .on(t.schoolId, t.academicYearId, t.teacherId, t.day, t.period)
      .where(sql`${t.teacherId} is not null`),
    index('schedule_slots_school_id_year_time_idx').on(t.schoolId, t.academicYearId, t.day, t.period),
    dayCheck('schedule_slots_day_check', t.day),
  ],
);
