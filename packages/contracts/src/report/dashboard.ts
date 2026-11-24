import { z } from 'zod';
import { EarlyWarningKind } from '../student-affairs/early-warning';
import { AttendanceCounts } from './recap';

/** Dasbor kepala sekolah (RKP-05): the day at a glance, from the same data as the rekap, sessions, early warnings and MBG. */

/** The trend covers this many school dates ending today (days without a rekap are left out). */
export const DASHBOARD_TREND_DAYS = 14;
/** At most this many students are listed under "berisiko"; `students` counts all of them. */
export const DASHBOARD_AT_RISK_LIMIT = 5;

export const PrincipalDashboard = z
  .object({
    schoolDate: z.iso.date(),
    attendance: z.object({
      today: z.object({
        counts: AttendanceCounts,
        /** Student-days with a status today. */
        days: z.int().nonnegative(),
        /** (H + T) / days, 0..1; null before any rekap row exists today. */
        presentRate: z.number().min(0).max(1).nullable(),
      }),
      /** Oldest first; only dates that have rekap rows. */
      trend: z.array(z.object({ date: z.iso.date(), presentRate: z.number().min(0).max(1).nullable(), days: z.int().nonnegative() })),
    }),
    /** Class and daily sessions of today. `open` are not due yet and do not lower fillRate. */
    sessions: z.object({ total: z.int(), filled: z.int(), missed: z.int(), open: z.int(), fillRate: z.number().min(0).max(1).nullable() }),
    /** Null when student.early_warning is off or the role may not read warnings (admin, kepsek, wakasek may). */
    atRisk: z
      .object({
        students: z.int().nonnegative(),
        items: z.array(z.object({ enrollmentId: z.uuid(), name: z.string(), className: z.string(), kinds: z.array(EarlyWarningKind), lastDate: z.iso.date() })),
      })
      .nullable(),
    /** Null when the school does not receive MBG (mbg.enabled off). */
    mbg: z.object({ status: z.enum(['pending', 'counted', 'not_school_day']), enrolled: z.int(), present: z.int(), unrecorded: z.int() }).nullable(),
  })
  .meta({ id: 'PrincipalDashboard' });
export type PrincipalDashboard = z.infer<typeof PrincipalDashboard>;
