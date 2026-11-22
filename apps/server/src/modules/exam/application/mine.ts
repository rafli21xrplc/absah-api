import type { MyExams } from '@absah/contracts';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { anyRole, type Actor } from '../../../shared/policy';
import { canViewMyExams } from '../domain/policies';
import { checkedInAmong } from '../infrastructure/attendance-repo';
import { ownEnrollments, placesOf } from '../infrastructure/mine-repo';
import { listPeriods } from '../infrastructure/period-repo';
import { evaluateStudents } from './eligibility';

/**
 * GET /exam/mine: for each exam still ahead or today (not closed), each of the caller's own students with "boleh ujian"
 * right now (the same computation the wali kelas' list and the room's door use), the reasons when not, the room and the
 * seat, and whether they have already arrived. The caller's own children only: a parent by guardians.user_id, a student
 * by students.user_id.
 */
export function myExams(actor: Actor, today: string): Promise<MyExams> {
  authorize(actor, canViewMyExams);
  const as = anyRole('siswa').allows(actor) ? 'student' : 'parent';
  return withTenant({ schoolId: actor.schoolId, userId: actor.userId }, async (tx) => {
    const items: MyExams['items'] = [];
    const periods = (await listPeriods(tx, false)).filter((p) => p.endsOn >= today).sort((a, b) => a.startsOn.localeCompare(b.startsOn) || a.id.localeCompare(b.id));
    for (const period of periods) {
      const own = await ownEnrollments(tx, actor.userId, as, period.academicYearId);
      if (own.length === 0) continue;
      const ids = own.map((o) => o.enrollmentId);
      const verdicts = new Map((await evaluateStudents(tx, period, own, today)).map((v) => [v.s.enrollmentId, v]));
      const places = await placesOf(tx, period.id, ids);
      const arrived = new Set(await checkedInAmong(tx, period.id, ids));
      for (const o of own) {
        const v = verdicts.get(o.enrollmentId);
        items.push({
          studentId: o.studentId,
          enrollmentId: o.enrollmentId,
          student: { name: o.name },
          className: o.className,
          period: { id: period.id, name: period.name, startsOn: period.startsOn, endsOn: period.endsOn },
          eligible: v?.eligible ?? false,
          reasons: v?.reasons ?? [],
          room: places.get(o.enrollmentId) ?? null,
          arrived: arrived.has(o.enrollmentId),
        });
      }
    }
    return { items };
  });
}
