import { ATTENDANCE_STATUSES, PORTAL_HISTORY_DAYS, type AttendanceStatus, type PortalAttendance } from '@absah/contracts';
import { withTenant } from '../../../shared/db';
import { ForbiddenError } from '../../../shared/errors';
import { anyRole, type Actor } from '../../../shared/policy';
import { schoolDate } from '../../../shared/school-date';
import { dailyHistory, portalStudents } from '../infrastructure/history-repo';
import { dayOf } from '../infrastructure/link-repo';

const isStudent = anyRole('siswa');
const isParent = anyRole('orang_tua');

const daysBefore = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) - days * 86_400_000).toISOString().slice(0, 10);

/** ORT-02: a siswa's own attendance, or an orang_tua's children's; nobody else's. */
export function portalAttendance(actor: Actor, timezone: string, now = new Date()): Promise<PortalAttendance> {
  const as = isStudent.allows(actor) ? 'student' : isParent.allows(actor) ? 'parent' : null;
  if (!as) throw new ForbiddenError('Riwayat ini untuk siswa dan orang tua.');
  return withTenant({ schoolId: actor.schoolId, userId: actor.userId }, async (tx) => {
    const today = schoolDate(timezone, now);
    const since = daysBefore(today, PORTAL_HISTORY_DAYS);
    const items = [];
    for (const s of await portalStudents(tx, actor.userId, as)) {
      const [days, day] = await Promise.all([dailyHistory(tx, s.enrollmentId, since), dayOf(tx, s.enrollmentId, today)]);
      const counts = Object.fromEntries(ATTENDANCE_STATUSES.map((k) => [k, 0])) as Record<AttendanceStatus, number>;
      for (const d of days) counts[d.status] += 1;
      items.push({
        studentId: s.studentId,
        name: s.name,
        className: s.className,
        today: { date: today, status: day.status, arrivedAt: day.arrivedAt?.toISOString() ?? null },
        days,
        counts,
      });
    }
    return { items };
  });
}
