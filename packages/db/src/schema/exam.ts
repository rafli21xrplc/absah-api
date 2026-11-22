import { sql } from 'drizzle-orm';
import { boolean, check, date, foreignKey, index, pgTable, smallint, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import { academicYears, enrollments } from './academic';
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

/** A room where an exam period is sat (UJN-03); the pengawas (supervisor) is a member of the school, optional. */
export const examRooms = pgTable(
  'exam_rooms',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id')
      .notNull()
      .references(() => examPeriods.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    capacity: smallint('capacity'),
    supervisorId: uuid('supervisor_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('exam_rooms_period_name_key').on(t.periodId, t.name),
    unique('exam_rooms_id_period_key').on(t.id, t.periodId),
    index('exam_rooms_school_id_period_id_idx').on(t.schoolId, t.periodId),
    check('exam_rooms_capacity_check', sql`${t.capacity} is null or ${t.capacity} > 0`),
  ],
);

/** A student's place in a room for a period: one room per student per period; seat numbers are unique within a room. */
export const examSeats = pgTable(
  'exam_seats',
  {
    id: id(),
    schoolId: schoolId().references(() => schools.id, { onDelete: 'cascade' }),
    periodId: uuid('period_id').notNull(),
    roomId: uuid('room_id').notNull(),
    enrollmentId: uuid('enrollment_id')
      .notNull()
      .references(() => enrollments.id, { onDelete: 'cascade' }),
    seatNo: smallint('seat_no').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    unique('exam_seats_period_enrollment_key').on(t.periodId, t.enrollmentId),
    unique('exam_seats_room_seat_key').on(t.roomId, t.seatNo),
    // The period of a seat is the period of its room: a seat cannot name a room of another period.
    foreignKey({ columns: [t.roomId, t.periodId], foreignColumns: [examRooms.id, examRooms.periodId], name: 'exam_seats_room_period_fk' }),
    index('exam_seats_school_id_room_id_idx').on(t.schoolId, t.roomId),
  ],
);
