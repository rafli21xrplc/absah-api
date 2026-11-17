import type { ClassStudentHours } from '@absah/contracts';
import { withTenant } from '../../../shared/db';
import { NotFoundError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { canSeeAllSessions } from '../domain/policies';
import { classHeader, classStudentsOn, groupMembersOfClass, listSessions, recordsOfSessions } from '../infrastructure/attendance-repo';

const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');

/**
 * AKD-10: a rombel's day as its wali kelas sees it. Rombel sessions cover every student; a learning
 * group session only its members. Anyone but the wali kelas and the school's session viewers gets 404.
 */
export function classStudentHours(actor: Actor, classId: string, schoolDate: string): Promise<ClassStudentHours> {
  return withTenant({ schoolId: actor.schoolId, userId: actor.userId }, async (tx) => {
    const cls = await classHeader(tx, classId);
    if (!cls || (cls.homeroomTeacherId !== actor.userId && !canSeeAllSessions.allows(actor))) throw new NotFoundError('Rombel tidak ditemukan.');
    const sessions = (await listSessions(tx, { date: schoolDate, forClass: classId })).filter((r) => r.mode !== 'activity');
    const [students, memberships, records] = await Promise.all([
      classStudentsOn(tx, classId, schoolDate),
      groupMembersOfClass(tx, classId),
      recordsOfSessions(
        tx,
        sessions.map((r) => r.id),
      ),
    ]);
    const inGroup = new Set(memberships.map((m) => `${m.groupId}:${m.enrollmentId}`));
    const status = new Map(records.map((r) => [`${r.sessionId}:${r.enrollmentId}`, r.status]));
    return {
      classId,
      className: cls.name,
      schoolDate,
      sessions: sessions.map((r) => ({
        id: r.id,
        mode: r.mode,
        status: r.status,
        owner: { type: r.ownerType, id: r.ownerId, name: r.ownerName },
        period: r.periodNumber !== null && r.startsAt ? { number: r.periodNumber, startsAt: hhmm(r.startsAt), endsAt: hhmm(r.endsAt) } : null,
        subject: r.subjectId && r.subjectName ? { id: r.subjectId, name: r.subjectName } : null,
        teacher: r.teacherId ? { id: r.teacherId, name: r.teacherName ?? '' } : null,
      })),
      students: students.map((st) => ({
        enrollmentId: st.enrollmentId,
        studentId: st.studentId,
        name: st.name,
        daily: st.daily,
        sessions: sessions
          .filter((r) => r.ownerType === 'class' || inGroup.has(`${r.ownerId}:${st.enrollmentId}`))
          .map((r) => ({ sessionId: r.id, status: status.get(`${r.id}:${st.enrollmentId}`) ?? null })),
      })),
    };
  });
}
