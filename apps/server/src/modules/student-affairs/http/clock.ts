import type { Request } from 'express';
import { getCtx } from '../../../shared/context';
import { schoolDate } from '../../../shared/school-date';

/** Today on the selected school's clock (default Asia/Jakarta). */
export const todayOf = (req: Request): string => {
  const ctx = getCtx(req);
  return schoolDate(ctx.memberships.find((m) => m.schoolId === ctx.schoolId)?.timezone ?? 'Asia/Jakarta');
};
