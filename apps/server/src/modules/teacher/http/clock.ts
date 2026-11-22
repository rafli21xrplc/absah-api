import type { Request } from 'express';
import { getCtx } from '../../../shared/context';
import { schoolDate, schoolMinutes } from '../../../shared/school-date';
import type { SchoolClock } from '../application/attendance';

/** Now on the selected school's clock (default Asia/Jakarta). */
export const clockOf = (req: Request, now: Date = new Date()): SchoolClock => {
  const ctx = getCtx(req);
  const timezone = ctx.memberships.find((m) => m.schoolId === ctx.schoolId)?.timezone ?? 'Asia/Jakarta';
  return { now, date: schoolDate(timezone, now), minutes: schoolMinutes(timezone, now) };
};
