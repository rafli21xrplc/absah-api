import { z } from 'zod';

/**
 * Early warnings (KSW-04, behind student.early_warning): the job ksw.early-warning looks at each school
 * after 18.00 on its own clock and raises a warning for a student whose recent attendance shows a pattern.
 * Which patterns are looked for follows the school's capabilities (jam pelajaran, PKL), never its level.
 */
export const EARLY_WARNING_KINDS = ['consecutive_alpa', 'repeated_late', 'bolos_jam', 'pkl_absence'] as const;
export const EarlyWarningKind = z.enum(EARLY_WARNING_KINDS).meta({ id: 'EarlyWarningKind' });
export type EarlyWarningKind = z.infer<typeof EarlyWarningKind>;

export const EarlyWarning = z
  .object({
    id: z.uuid(),
    student: z.object({ enrollmentId: z.uuid(), name: z.string(), className: z.string() }),
    kind: EarlyWarningKind,
    /** The school date the job raised it. */
    date: z.iso.date(),
    /** The school dates that make the pattern, oldest first. */
    dates: z.array(z.iso.date()),
  })
  .meta({ id: 'EarlyWarning' });
export type EarlyWarning = z.infer<typeof EarlyWarning>;

/** GET /api/v1/early-warnings[?days=14]: newest first over the last `days` days (1..60), at most 200. */
export const EarlyWarningsQuery = z.object({ days: z.coerce.number().int().min(1).max(60).optional() }).meta({ id: 'EarlyWarningsQuery' });
export type EarlyWarningsQuery = z.infer<typeof EarlyWarningsQuery>;

export const EarlyWarningList = z.object({ items: z.array(EarlyWarning) }).meta({ id: 'EarlyWarningList' });
export type EarlyWarningList = z.infer<typeof EarlyWarningList>;
