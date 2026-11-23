import type { EligibilityList, EligibilityQuery } from '@absah/contracts';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { NotFoundError } from '../../../shared/errors';
import { anyRole, type Actor } from '../../../shared/policy';
import { evaluateEligibility } from '../domain/eligibility';
import { canReadExams } from '../domain/policies';
import { findPeriod } from '../infrastructure/period-repo';
import { attendanceCounts, findClass, studentsOf, unpaidInstallmentCounts, yearStart } from '../infrastructure/eligibility-repo';

/** The wakasek, kepsek and admin see every rombel; a wali kelas only their own. */
const seesAllClasses = anyRole('wakasek', 'kepsek', 'admin');

const NONE = { H: 0, T: 0, S: 0, I: 0, A: 0 };

/**
 * GET /exam/periods/{id}/eligibility (UJN-02): who may sit, and why not, for the wali kelas to act on. Computed now from
 * the attendance (from attendance_from to the first exam day, no later than today) and the bills (unpaid installments due
 * on or before the first exam day), by the rule of the period; nothing is stored, so a bill paid a minute ago already
 * counts. The reasons carry the student's own number and how many installments are open, never the amounts.
 */
export function examEligibility(actor: Actor, periodId: string, query: EligibilityQuery, today: string): Promise<EligibilityList> {
  authorize(actor, canReadExams);
  const all = seesAllClasses.allows(actor);
  return withTenant({ schoolId: actor.schoolId, userId: actor.userId }, async (tx) => {
    const period = await findPeriod(tx, periodId);
    if (!period) throw new NotFoundError('Ujian tidak ditemukan.');
    if (query.classId && !all) {
      const cls = await findClass(tx, query.classId);
      if (!cls || cls.homeroomTeacherId !== actor.userId) throw new NotFoundError('Rombel tidak ditemukan.');
    }
    const students = await studentsOf(tx, period.academicYearId, { classId: query.classId, homeroomTeacherId: all ? undefined : actor.userId });
    const ids = students.map((s) => s.enrollmentId);
    const from = period.attendanceFrom ?? (await yearStart(tx, period.academicYearId));
    const to = period.startsOn < today ? period.startsOn : today;
    // One after the other: a transaction has one connection.
    const counts = await attendanceCounts(tx, ids, from, to);
    const unpaid = period.requirePaid ? await unpaidInstallmentCounts(tx, ids, period.startsOn, period.feeTypeIds) : new Map<string, number>();
    const rule = { minAttendance: period.minAttendance, excusedCounts: period.excusedCounts, requirePaid: period.requirePaid };
    const evaluated = students.map((s) => ({ s, ...evaluateEligibility(rule, counts.get(s.enrollmentId) ?? NONE, unpaid.get(s.enrollmentId) ?? 0) }));
    const ineligible = evaluated.filter((x) => !x.eligible);
    return {
      period: { id: period.id, name: period.name },
      items: (query.show === 'all' ? evaluated : ineligible).map((x) => ({ enrollmentId: x.s.enrollmentId, student: { name: x.s.name }, className: x.s.className, eligible: x.eligible, reasons: x.reasons })),
      counts: { students: evaluated.length, eligible: evaluated.length - ineligible.length, ineligible: ineligible.length },
    };
  });
}
