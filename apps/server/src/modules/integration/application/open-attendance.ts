import { OPEN_ATTENDANCE_MAX_DAYS_BACK, type OpenDailyAttendance, type OpenDailyAttendanceQuery } from '@absah/contracts';
import { dailyStatusesOn } from '../../attendance';
import { withTenant } from '../../../shared/db';
import { ValidationError } from '../../../shared/errors';
import { addDays } from '../../../shared/school-date';
import type { ApiKeyCaller } from '../http/api-key-auth';

/** GET /open/attendance/daily: the recorded daily statuses of the key's school on one date: ids and statuses, nothing personal. */
export function openDailyAttendance(caller: ApiKeyCaller, query: OpenDailyAttendanceQuery): Promise<OpenDailyAttendance> {
  const date = query.date ?? caller.today;
  if (date > caller.today) throw new ValidationError({ date: 'future' }, 'Tanggal tidak boleh di masa depan.');
  if (date < addDays(caller.today, -OPEN_ATTENDANCE_MAX_DAYS_BACK)) throw new ValidationError({ date: 'too_old' }, `Tanggal paling jauh ${OPEN_ATTENDANCE_MAX_DAYS_BACK} hari ke belakang.`);
  return withTenant({ schoolId: caller.schoolId, userId: null }, async (tx) => ({ date, items: await dailyStatusesOn(tx, date, query.classId) }));
}
