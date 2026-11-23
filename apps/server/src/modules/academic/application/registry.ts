import type { ClassList, StudentList, StudentListItem, StudentListQuery, UpdateEnrollmentRequest } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { schoolDate } from '../../../shared/school-date';
import { canManageStudentData, canReadStudentData } from '../domain/policies';
import { listClassesWithCounts, listStudentsPage, lockEnrollment } from '../infrastructure/registry-read-repo';
import { lockSchoolProfile } from '../infrastructure/school-settings-repo';
import { findActiveAcademicYear } from '../infrastructure/student-import-repo';
import { updateEnrollment } from '../infrastructure/student-registry-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });

const encodeCursor = (name: string, id: string) => Buffer.from(JSON.stringify([name, id])).toString('base64url');
function decodeCursor(cursor: string): { name: string; id: string } {
  try {
    const value: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString());
    if (Array.isArray(value) && typeof value[0] === 'string' && typeof value[1] === 'string') return { name: value[0], id: value[1] };
  } catch {
    // fall through
  }
  throw new ValidationError({ cursor: 'invalid' }, 'Kursor tidak valid.');
}

type StudentRow = Awaited<ReturnType<typeof listStudentsPage>>[number];
function toItem(r: StudentRow): StudentListItem {
  return {
    id: r.id,
    name: r.name,
    nisn: r.nisn,
    localId: r.localId,
    gender: r.gender,
    birthDate: r.birthDate,
    enrollment:
      r.enrollmentId && r.classId && r.className && r.enrollmentStatus
        ? { id: r.enrollmentId, classId: r.classId, className: r.className, status: r.enrollmentStatus, missingSince: r.missingSince?.toISOString() ?? null }
        : null,
  };
}

export async function listStudents(actor: Actor, query: StudentListQuery): Promise<StudentList> {
  authorize(actor, canReadStudentData);
  const after = query.cursor ? decodeCursor(query.cursor) : undefined;
  return withTenant(scope(actor), async (tx) => {
    const year = await findActiveAcademicYear(tx);
    const rows = await listStudentsPage(tx, { ...query, after, academicYearId: year?.id ?? null });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return { items: page.map(toItem), nextCursor: rows.length > query.limit && last ? encodeCursor(last.name, last.id) : null };
  });
}

export async function listClasses(actor: Actor): Promise<ClassList> {
  authorize(actor, canReadStudentData);
  return withTenant(scope(actor), async (tx) => {
    const year = await findActiveAcademicYear(tx);
    if (!year) return { academicYear: null, items: [] };
    const rows = await listClassesWithCounts(tx, year.id);
    return {
      academicYear: { id: year.id, name: year.name },
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        grade: r.grade,
        stream: r.stream,
        homeroomTeacher: r.homeroomTeacherId && r.homeroomTeacherName ? { id: r.homeroomTeacherId, name: r.homeroomTeacherName } : null,
        activeStudents: r.activeStudents,
        missingStudents: r.missingStudents,
      })),
    };
  });
}

async function studentItem(tx: Tx, studentId: string, academicYearId: string): Promise<StudentListItem> {
  const [row] = await listStudentsPage(tx, { academicYearId, studentId, status: 'all', limit: 1 });
  if (!row) throw new NotFoundError('Siswa tidak ditemukan.');
  return toItem(row);
}

/**
 * Settles a calon keluar student. active keeps them in the rombel (flag cleared); moved/left ends
 * the enrollment, which also takes the student out of future attendance sessions.
 */
export async function updateEnrollmentStatus(
  actor: Actor,
  auditCtx: AuditContext,
  enrollmentId: string,
  input: UpdateEnrollmentRequest,
): Promise<StudentListItem> {
  authorize(actor, canManageStudentData);
  return withTenant(scope(actor), async (tx) => {
    const enrollment = await lockEnrollment(tx, enrollmentId);
    if (!enrollment) throw new NotFoundError('Data rombel siswa tidak ditemukan.');
    if (enrollment.status !== 'active') throw new ConflictError('Siswa ini sudah tidak aktif di rombel tersebut.');
    const profile = await lockSchoolProfile(tx, actor.schoolId);
    const today = schoolDate(profile?.timezone ?? 'Asia/Jakarta');
    const endsOn = input.endsOn ?? today;
    if (input.status !== 'active' && (endsOn < enrollment.startsOn || endsOn > today)) {
      throw new ValidationError({ endsOn: 'out_of_range' }, 'Tanggal keluar harus di antara tanggal masuk rombel dan hari ini.');
    }

    const after =
      input.status === 'active'
        ? { missingSince: null }
        : { status: input.status, endsOn, missingSince: null };
    await updateEnrollment(tx, enrollment.id, after);
    await audit(tx, auditCtx, 'enrollment.status_changed', { type: 'enrollment', id: enrollment.id }, {
      before: { status: enrollment.status, missingSince: enrollment.missingSince?.toISOString() ?? null },
      after: { status: input.status, endsOn: input.status === 'active' ? null : endsOn },
    });
    return studentItem(tx, enrollment.studentId, enrollment.academicYearId);
  });
}
