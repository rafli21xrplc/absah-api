import {
  CALENDAR_DAY_KINDS,
  CLASS_STREAMS,
  CONSENT_METHODS,
  CONSENT_PURPOSES,
  ENROLLMENT_STATUSES,
  GENDERS,
  GUARDIAN_RELATIONS,
} from '@absah/contracts';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  date,
  index,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { encryptedText } from '../crypto';
import { createdAt, id, schoolId } from './_shared';
import { user } from './auth';
import { schools } from './platform';

export const gender = pgEnum('gender', GENDERS);
export const classStream = pgEnum('class_stream', CLASS_STREAMS);
export const enrollmentStatus = pgEnum('enrollment_status', ENROLLMENT_STATUSES);
export const guardianRelation = pgEnum('guardian_relation', GUARDIAN_RELATIONS);
export const calendarDayKind = pgEnum('calendar_day_kind', CALENDAR_DAY_KINDS);
export const consentPurpose = pgEnum('consent_purpose', CONSENT_PURPOSES);
export const consentMethod = pgEnum('consent_method', CONSENT_METHODS);

const updatedAt = () => timestamp('updated_at', { withTimezone: true }).notNull().defaultNow();
const schoolRef = () => schoolId().references(() => schools.id, { onDelete: 'cascade' });

/** Tahun ajaran, e.g. "2026/2027". At most one active per school. */
export const academicYears = pgTable(
  'academic_years',
  {
    id: id(),
    schoolId: schoolRef(),
    name: text('name').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
    isActive: boolean('is_active').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    unique('academic_years_school_id_name_key').on(t.schoolId, t.name),
    uniqueIndex('academic_years_one_active_idx').on(t.schoolId).where(sql`${t.isActive}`),
    check('academic_years_dates_check', sql`${t.startsOn} < ${t.endsOn}`),
  ],
);

export const semesters = pgTable(
  'semesters',
  {
    id: id(),
    schoolId: schoolRef(),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'cascade' }),
    number: smallint('number').notNull(),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on').notNull(),
  },
  (t) => [
    unique('semesters_academic_year_id_number_key').on(t.academicYearId, t.number),
    index('semesters_school_id_idx').on(t.schoolId),
    check('semesters_number_check', sql`${t.number} in (1, 2)`),
    check('semesters_dates_check', sql`${t.startsOn} < ${t.endsOn}`),
  ],
);

/** Exceptions to the weekly school days: holidays and extra school days (school date). */
export const calendarDays = pgTable(
  'calendar_days',
  {
    schoolId: schoolRef(),
    date: date('date').notNull(),
    kind: calendarDayKind('kind').notNull(),
    name: text('name').notNull(),
    createdAt: createdAt(),
  },
  (t) => [primaryKey({ columns: [t.schoolId, t.date] })],
);

/** Rombel. grade 1-12 (SD 1-6, SMP 7-9, SMA/SMK 10-12, SMK 4 tahun 13). */
export const classes = pgTable(
  'classes',
  {
    id: id(),
    schoolId: schoolRef(),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'restrict' }),
    name: text('name').notNull(),
    grade: smallint('grade').notNull(),
    stream: classStream('stream'),
    homeroomTeacherId: uuid('homeroom_teacher_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    unique('classes_school_id_academic_year_id_name_key').on(t.schoolId, t.academicYearId, t.name),
    check('classes_grade_check', sql`${t.grade} between 1 and 13`),
  ],
);

/**
 * A student as known to the school. NIK is encrypted (read rarely) and matched through nik_hash.
 * NISN is the national student number (10 digits) and the first matching key on import.
 */
export const students = pgTable(
  'students',
  {
    id: id(),
    schoolId: schoolRef(),
    name: text('name').notNull(),
    nisn: text('nisn'),
    nik: encryptedText('nik', 'students.nik'),
    nikHash: text('nik_hash'),
    /** Nomor induk lokal (NIPD/NIS). */
    localId: text('local_id'),
    gender: gender('gender'),
    birthPlace: text('birth_place'),
    birthDate: date('birth_date'),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('students_school_id_nisn_key').on(t.schoolId, t.nisn).where(sql`${t.nisn} is not null`),
    uniqueIndex('students_school_id_nik_hash_key').on(t.schoolId, t.nikHash).where(sql`${t.nikHash} is not null`),
    index('students_school_id_name_idx').on(t.schoolId, t.name),
    check('students_nisn_check', sql`${t.nisn} ~ '^[0-9]{10}$'`),
  ],
);

/**
 * A student's place in a class for one academic year. missing_since marks a student absent from the
 * latest import ("calon keluar"): staff confirm before the status becomes moved or left.
 */
export const enrollments = pgTable(
  'enrollments',
  {
    id: id(),
    schoolId: schoolRef(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    classId: uuid('class_id')
      .notNull()
      .references(() => classes.id, { onDelete: 'restrict' }),
    academicYearId: uuid('academic_year_id')
      .notNull()
      .references(() => academicYears.id, { onDelete: 'restrict' }),
    status: enrollmentStatus('status').notNull().default('active'),
    startsOn: date('starts_on').notNull(),
    endsOn: date('ends_on'),
    missingSince: timestamp('missing_since', { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex('enrollments_one_active_per_year_idx')
      .on(t.schoolId, t.studentId, t.academicYearId)
      .where(sql`${t.status} = 'active'`),
    index('enrollments_school_id_class_id_idx').on(t.schoolId, t.classId),
    index('enrollments_school_id_student_id_idx').on(t.schoolId, t.studentId),
  ],
);

/** Parent or guardian. The phone is encrypted; phone_hash finds a guardian by number. */
export const guardians = pgTable(
  'guardians',
  {
    id: id(),
    schoolId: schoolRef(),
    name: text('name').notNull(),
    phone: encryptedText('phone', 'guardians.phone'),
    phoneHash: text('phone_hash'),
    /** Set once the guardian signs in to the parent portal. */
    userId: uuid('user_id').references(() => user.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index('guardians_school_id_phone_hash_idx').on(t.schoolId, t.phoneHash),
    index('guardians_school_id_user_id_idx').on(t.schoolId, t.userId),
  ],
);

export const studentGuardians = pgTable(
  'student_guardians',
  {
    schoolId: schoolRef(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    guardianId: uuid('guardian_id')
      .notNull()
      .references(() => guardians.id, { onDelete: 'cascade' }),
    relation: guardianRelation('relation').notNull(),
    /** Receives notifications first. */
    isPrimary: boolean('is_primary').notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [
    primaryKey({ columns: [t.studentId, t.guardianId] }),
    index('student_guardians_school_id_guardian_id_idx').on(t.schoolId, t.guardianId),
  ],
);

/** Consent to process a child's data (UU 27/2022). Revoking keeps the row for the record. */
export const consents = pgTable(
  'consents',
  {
    id: id(),
    schoolId: schoolRef(),
    studentId: uuid('student_id')
      .notNull()
      .references(() => students.id, { onDelete: 'cascade' }),
    guardianId: uuid('guardian_id').references(() => guardians.id, { onDelete: 'set null' }),
    purpose: consentPurpose('purpose').notNull(),
    method: consentMethod('method').notNull(),
    grantedAt: timestamp('granted_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    recordedBy: uuid('recorded_by'),
    createdAt: createdAt(),
  },
  (t) => [index('consents_school_id_student_id_idx').on(t.schoolId, t.studentId)],
);
