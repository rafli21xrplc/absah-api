import type { CreateLearningGroupRequest, LearningGroup, LearningGroupDetail } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError, ScheduleConflictError, ValidationError } from '../../../shared/errors';
import { isUniqueViolation } from '../../../shared/pg-errors';
import type { Actor } from '../../../shared/policy';
import { canManageSchedule, canReadSchedule } from '../domain/policies';
import { findScheduleConflicts } from '../domain/schedule-conflicts';
import { activeEnrollments, insertGroup, listGroups, listMembers, replaceMembers, type GroupRow } from '../infrastructure/learning-group-repo';
import { findSubject, listSlots, lockSchedule, ownerKey, studentsOfOwners } from '../infrastructure/schedule-repo';
import { findActiveAcademicYear } from '../infrastructure/student-import-repo';
import { assertTeacher, CONFLICT_MESSAGE, describeConflicts, requireActiveYear } from './schedule';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });

const toGroup = (r: GroupRow): LearningGroup => ({
  id: r.id,
  name: r.name,
  subject: { id: r.subjectId, name: r.subjectName },
  teacher: r.teacherId ? { id: r.teacherId, name: r.teacherName ?? '' } : null,
  memberCount: r.memberCount,
});

async function detail(tx: Tx, academicYearId: string, groupId: string): Promise<LearningGroupDetail> {
  const [row] = await listGroups(tx, academicYearId, groupId);
  if (!row) throw new NotFoundError('Kelompok belajar tidak ditemukan.');
  return { ...toGroup(row), members: await listMembers(tx, groupId) };
}

export async function getLearningGroups(actor: Actor): Promise<{ items: LearningGroup[] }> {
  authorize(actor, canReadSchedule);
  return withTenant(scope(actor), async (tx) => {
    const year = await findActiveAcademicYear(tx);
    return { items: year ? (await listGroups(tx, year.id)).map(toGroup) : [] };
  });
}

export async function getLearningGroup(actor: Actor, groupId: string): Promise<LearningGroupDetail> {
  authorize(actor, canReadSchedule);
  return withTenant(scope(actor), async (tx) => detail(tx, (await requireActiveYear(tx)).id, groupId));
}

export async function createLearningGroup(actor: Actor, input: CreateLearningGroupRequest): Promise<LearningGroup> {
  authorize(actor, canManageSchedule);
  try {
    return await withTenant(scope(actor), async (tx) => {
      const year = await requireActiveYear(tx);
      if (!(await findSubject(tx, input.subjectId))) throw new ValidationError([{ path: 'subjectId', message: 'Mapel tidak ditemukan.' }]);
      await assertTeacher(tx, input.teacherId);
      const id = await insertGroup(tx, { schoolId: actor.schoolId, academicYearId: year.id, ...input });
      const [row] = await listGroups(tx, year.id, id);
      if (!row) throw new Error('group vanished');
      return toGroup(row);
    });
  } catch (err) {
    if (isUniqueViolation(err, 'learning_groups_school_id_year_name_key')) throw new ConflictError('Nama kelompok sudah dipakai tahun ini.');
    throw err;
  }
}

/**
 * Replaces the members. New members must not already have a lesson (through their rombel or
 * another group) at any of this group's lesson times: 409 SCHEDULE_CONFLICT.
 */
export async function setLearningGroupMembers(actor: Actor, groupId: string, enrollmentIds: string[]): Promise<LearningGroupDetail> {
  authorize(actor, canManageSchedule);
  const unique = [...new Set(enrollmentIds)];
  return withTenant(scope(actor), async (tx) => {
    await lockSchedule(tx, actor.schoolId);
    const year = await requireActiveYear(tx);
    await detail(tx, year.id, groupId); // 404 for unknown groups
    const enrollments = await activeEnrollments(tx, year.id, unique);
    if (enrollments.length !== unique.length) {
      throw new ValidationError([{ path: 'enrollmentIds', message: 'Ada siswa yang tidak aktif di tahun ajaran ini.' }]);
    }

    const owner = { ownerType: 'group' as const, ownerId: groupId };
    const own = await listSlots(tx, year.id, { owner });
    if (own.length > 0) {
      const others = (await listSlots(tx, year.id, { at: own.map((s) => ({ day: s.day, period: s.period })) })).filter((s) => ownerKey(s) !== ownerKey(owner));
      const students = await studentsOfOwners(tx, year.id, others);
      students.set(ownerKey(owner), new Set(enrollments.map((e) => e.studentId)));
      const ownIds = new Set(own.map((s) => s.id));
      const conflicts = findScheduleConflicts([...own, ...others], (o) => students.get(ownerKey(o)) ?? new Set()).filter(
        (c) => c.kind === 'student' && (ownIds.has(c.a.id) || ownIds.has(c.b.id)),
      );
      if (conflicts.length > 0) {
        const names = new Map(others.map((o) => [o.id, { ownerName: o.ownerName, teacherName: o.teacherName }]));
        throw new ScheduleConflictError(CONFLICT_MESSAGE, await describeConflicts(tx, conflicts, names, ownIds));
      }
    }

    await replaceMembers(tx, actor.schoolId, groupId, unique);
    return detail(tx, year.id, groupId);
  });
}
