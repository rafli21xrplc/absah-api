import { TEACHER_CHECKIN_ROLES, type TeacherReport, type TeacherReportQuery, type TeacherReportRow } from '@absah/contracts';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { NotFoundError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { findSchool, schoolDaysBetween } from '../../attendance';
import { canReadTeacherReport } from '../domain/policies';
import { classifyDays, monthSpan, presenceRate } from '../domain/report';
import { approvedLeavesBetween, checkInsBetween, namesOf, substitutionsTakenBetween } from '../infrastructure/report-repo';
import { substitutePool } from '../infrastructure/substitution-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/**
 * GET /teacher-attendance/report: each teacher's month so far. School days are the calendar's (holidays out, a make-up
 * Saturday in); a day is "present" with a check-in, on izin with an approved izin, otherwise "noRecord" (the school
 * asks; the system does not call it alpa). Teachers are the active staff who check in, plus anyone with a record in
 * the month, so someone who left keeps their history.
 */
export function teacherMonthlyReport(actor: Actor, today: string, query: TeacherReportQuery): Promise<TeacherReport> {
  authorize(actor, canReadTeacherReport);
  const month = query.month ?? today.slice(0, 7);
  const { from, through } = monthSpan(month, today);
  return withTenant(scope(actor), async (tx) => {
    const school = await findSchool(tx, actor.schoolId);
    const timezone = school?.timezone ?? 'Asia/Jakarta';
    const schoolDays = through ? await schoolDaysBetween(tx, from, through) : [];
    const upTo = through ?? from;
    const checkIns = through ? await checkInsBetween(tx, from, upTo) : [];
    const leaves = through ? await approvedLeavesBetween(tx, from, upTo) : [];
    const taken = through ? await substitutionsTakenBetween(tx, from, upTo, timezone) : new Map<string, number>();
    const pool = await substitutePool(tx, TEACHER_CHECKIN_ROLES);
    const ids = new Set([...pool.map((p) => p.userId), ...checkIns.map((c) => c.userId), ...leaves.map((l) => l.userId)]);
    if (query.teacherId && !ids.has(query.teacherId)) throw new NotFoundError('Guru tidak ditemukan.');
    const names = await namesOf(tx, [...ids]);

    const rows: TeacherReportRow[] = [];
    for (const userId of query.teacherId ? [query.teacherId] : ids) {
      const mine = checkIns.filter((c) => c.userId === userId);
      const { days, counts } = classifyDays({ schoolDays, checkIns: mine.map((c) => ({ date: c.date, late: c.late })), leaves: leaves.filter((l) => l.userId === userId) });
      const times = new Map(mine.map((c) => [c.date, c]));
      rows.push({
        teacher: { id: userId, name: names.get(userId) ?? 'Pengguna' },
        present: counts.present,
        late: counts.late,
        leave: counts.leave,
        noRecord: counts.noRecord,
        rate: presenceRate(counts.present, schoolDays.length),
        substitutionsTaken: taken.get(userId) ?? 0,
        ...(query.teacherId ? { days: days.map((d) => ({ date: d.date, status: d.status, checkedInAt: times.get(d.date)?.checkedInAt.toISOString() ?? null, checkedOutAt: times.get(d.date)?.checkedOutAt?.toISOString() ?? null })) } : {}),
      });
    }
    rows.sort((x, y) => x.teacher.name.localeCompare(y.teacher.name, 'id') || x.teacher.id.localeCompare(y.teacher.id));
    const present = sum(rows.map((r) => r.present));
    return {
      month,
      schoolDays: schoolDays.length,
      through,
      items: rows,
      totals: { present, late: sum(rows.map((r) => r.late)), leave: sum(rows.map((r) => r.leave.sakit + r.leave.izin + r.leave.dinas)), noRecord: sum(rows.map((r) => r.noRecord)), rate: presenceRate(present, schoolDays.length * rows.length) },
    };
  });
}
