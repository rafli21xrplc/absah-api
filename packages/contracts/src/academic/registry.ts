import { z } from 'zod';
import { ClassStream, EnrollmentStatus, Gender } from './enums';

/** Student and rombel registry for staff (AKD-01, AKD-02). */

const Cursor = z.string().max(500);
const SchoolDate = z.iso.date();

export const StudentListQuery = z
  .object({
    q: z.string().trim().max(100).optional(),
    classId: z.uuid().optional(),
    /** active = in a rombel this year; missing = calon keluar; all = every student. */
    status: z.enum(['active', 'missing', 'all']).default('active'),
    cursor: Cursor.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .meta({ id: 'StudentListQuery' });
export type StudentListQuery = z.infer<typeof StudentListQuery>;

export const StudentListItem = z
  .object({
    id: z.uuid(),
    name: z.string(),
    nisn: z.string().nullable(),
    localId: z.string().nullable(),
    gender: Gender.nullable(),
    birthDate: SchoolDate.nullable(),
    /** Active enrollment in the active academic year, if any. */
    enrollment: z
      .object({
        id: z.uuid(),
        classId: z.uuid(),
        className: z.string(),
        status: EnrollmentStatus,
        missingSince: z.iso.datetime().nullable(),
      })
      .nullable(),
  })
  .meta({ id: 'StudentListItem' });
export type StudentListItem = z.infer<typeof StudentListItem>;

export const StudentList = z
  .object({ items: z.array(StudentListItem), nextCursor: Cursor.nullable() })
  .meta({ id: 'StudentList' });
export type StudentList = z.infer<typeof StudentList>;

export const ClassListItem = z
  .object({
    id: z.uuid(),
    name: z.string(),
    grade: z.int(),
    stream: ClassStream.nullable(),
    homeroomTeacher: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    activeStudents: z.int(),
    /** Calon keluar: absent from the latest import. */
    missingStudents: z.int(),
  })
  .meta({ id: 'ClassListItem' });

export const ClassList = z
  .object({
    academicYear: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    items: z.array(ClassListItem),
  })
  .meta({ id: 'ClassList' });
export type ClassList = z.infer<typeof ClassList>;

export const EnrollmentIdParam = z.object({ enrollmentId: z.uuid() });

/**
 * PATCH /api/v1/enrollments/{enrollmentId} (admin, operator): settles a calon keluar student.
 * active keeps the student (clears the flag); moved/left ends the enrollment on endsOn (default today).
 */
export const UpdateEnrollmentRequest = z
  .object({
    status: z.enum(['active', 'moved', 'left']),
    endsOn: SchoolDate.optional(),
  })
  .strict()
  .meta({ id: 'UpdateEnrollmentRequest' });
export type UpdateEnrollmentRequest = z.infer<typeof UpdateEnrollmentRequest>;
