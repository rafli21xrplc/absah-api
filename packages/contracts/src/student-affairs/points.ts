import { z } from 'zod';

/**
 * Point rules (KSW-01, behind student.points): one table per school. A pelanggaran carries negative
 * points and a prestasi positive ones, so the sign always agrees with the kind (checked here and by the
 * database). Rules are switched off, never deleted: entries (KSW-02) keep a copy of what they cited.
 */
export const POINT_KINDS = ['violation', 'achievement'] as const;
export const PointKind = z.enum(POINT_KINDS).meta({ id: 'PointKind' });
export type PointKind = z.infer<typeof PointKind>;

export const POINT_RULE_MAX_POINTS = 100;

const Points = z.number().int().min(-POINT_RULE_MAX_POINTS).max(POINT_RULE_MAX_POINTS).refine((n) => n !== 0, 'Poin tidak boleh nol.');

/** True when the points point the right way for the kind: negative for pelanggaran, positive for prestasi. */
export const pointsMatchKind = (kind: PointKind, points: number): boolean => (kind === 'violation' ? points < 0 : points > 0);

const SIGN_MESSAGE = 'Pelanggaran bernilai negatif, prestasi positif.';

const RuleFields = z.object({
  kind: PointKind,
  category: z.string().trim().min(2, 'Tulis kategori.').max(40),
  name: z.string().trim().min(2, 'Tulis nama aturan.').max(100),
  points: Points,
});

/** POST /api/v1/point-rules (admin, wakasek). */
export const CreatePointRuleRequest = RuleFields.strict()
  .refine((r) => pointsMatchKind(r.kind, r.points), { path: ['points'], message: SIGN_MESSAGE })
  .meta({ id: 'CreatePointRuleRequest' });
export type CreatePointRuleRequest = z.infer<typeof CreatePointRuleRequest>;

/** PUT /api/v1/point-rules/{ruleId}: fields left out stay. The kind cannot change; new points must keep its sign. */
export const UpdatePointRuleRequest = RuleFields.omit({ kind: true })
  .extend({ active: z.boolean() })
  .partial()
  .strict()
  .meta({ id: 'UpdatePointRuleRequest' });
export type UpdatePointRuleRequest = z.infer<typeof UpdatePointRuleRequest>;

export const PointRuleIdParam = z.object({ ruleId: z.uuid() });

export const PointRule = z
  .object({ id: z.uuid(), kind: PointKind, category: z.string(), name: z.string(), points: z.number().int(), active: z.boolean() })
  .meta({ id: 'PointRule' });
export type PointRule = z.infer<typeof PointRule>;

/** GET /api/v1/point-rules[?all=true]: active rules by kind, category and name; all=true adds the switched-off ones. */
export const PointRulesQuery = z.object({ all: z.stringbool().optional() }).meta({ id: 'PointRulesQuery' });
export type PointRulesQuery = z.infer<typeof PointRulesQuery>;

export const PointRuleList = z.object({ items: z.array(PointRule) }).meta({ id: 'PointRuleList' });
export type PointRuleList = z.infer<typeof PointRuleList>;
