import type { Request } from 'express';
import { getCtx } from '../../../shared/context';
import { schoolDate } from '../../../shared/school-date';

/** The selected school's timezone (default Asia/Jakarta). */
export const timezoneOf = (req: Request) => {
  const ctx = getCtx(req);
  return ctx.memberships.find((m) => m.schoolId === ctx.schoolId)?.timezone ?? 'Asia/Jakarta';
};

/** Today on the school's clock. */
export const todayOf = (req: Request) => schoolDate(timezoneOf(req));
