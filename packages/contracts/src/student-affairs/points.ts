import { z } from 'zod';
import { PresignedUpload } from '../academic/imports';

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

/**
 * Point entries (KSW-02): a pelanggaran or prestasi recorded against a student's enrollment (so totals
 * are per student per academic year). Insert-only: an entry keeps a copy of the rule's title, category
 * and points as they were; a mistake is undone by a reversing entry, never by editing or deleting.
 * The note is encrypted. Optional evidence is a photo or PDF in R2 (schools/{id}/ksw/{uuid}).
 */
export const POINT_ENTRY_MAX_BACKDATE_DAYS = 30;
export const POINT_EVIDENCE_MAX_BYTES = 5 * 1024 * 1024;
export const POINT_EVIDENCE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const PointEvidenceType = z.enum(POINT_EVIDENCE_TYPES).meta({ id: 'PointEvidenceType' });

/** POST /api/v1/point-entries/evidence: a presigned PUT for the photo or file. */
export const CreatePointEvidenceRequest = z
  .object({ fileSize: z.int().positive().max(POINT_EVIDENCE_MAX_BYTES, 'Bukti maksimal 5 MB.'), contentType: PointEvidenceType })
  .strict()
  .meta({ id: 'CreatePointEvidenceRequest' });
export type CreatePointEvidenceRequest = z.infer<typeof CreatePointEvidenceRequest>;

export const CreatePointEvidenceResponse = z.object({ evidenceId: z.uuid(), upload: PresignedUpload }).meta({ id: 'CreatePointEvidenceResponse' });
export type CreatePointEvidenceResponse = z.infer<typeof CreatePointEvidenceResponse>;

/** POST /api/v1/point-entries (admin, wakasek, wali kelas, guru): date defaults to today, at most 30 days back. */
export const CreatePointEntryRequest = z
  .object({
    enrollmentId: z.uuid(),
    ruleId: z.uuid(),
    date: z.iso.date().optional(),
    note: z.string().trim().max(500).optional(),
    evidence: z.object({ id: z.uuid(), contentType: PointEvidenceType }).strict().optional(),
  })
  .strict()
  .meta({ id: 'CreatePointEntryRequest' });
export type CreatePointEntryRequest = z.infer<typeof CreatePointEntryRequest>;

/** POST /api/v1/point-entries/{entryId}/reverse (admin, wakasek): the reason is kept with the reversing entry. */
export const ReversePointEntryRequest = z
  .object({ reason: z.string().trim().min(3, 'Tulis alasan pembatalan.').max(300) })
  .strict()
  .meta({ id: 'ReversePointEntryRequest' });
export type ReversePointEntryRequest = z.infer<typeof ReversePointEntryRequest>;

export const PointEntryIdParam = z.object({ entryId: z.uuid() });
export const PointStudentParam = z.object({ enrollmentId: z.uuid() });

export const PointEntry = z
  .object({
    id: z.uuid(),
    enrollmentId: z.uuid(),
    kind: PointKind,
    category: z.string(),
    rule: z.string(),
    points: z.number().int(),
    date: z.iso.date(),
    note: z.string().nullable(),
    hasEvidence: z.boolean(),
    /** Set on a reversing entry: the entry it cancels. */
    reversesEntryId: z.uuid().nullable(),
    /** True once a reversing entry exists for this one. */
    reversed: z.boolean(),
    recordedBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    createdAt: z.iso.datetime(),
  })
  .meta({ id: 'PointEntry' });
export type PointEntry = z.infer<typeof PointEntry>;

/** GET /api/v1/students/{enrollmentId}/points (admin, kepsek, wakasek, the student's wali kelas): newest first. */
export const StudentPoints = z
  .object({
    student: z.object({ enrollmentId: z.uuid(), name: z.string(), className: z.string() }),
    /** Net of reversals: violationPoints is zero or negative, achievementPoints zero or positive. */
    total: z.number().int(),
    violationPoints: z.number().int(),
    achievementPoints: z.number().int(),
    items: z.array(PointEntry),
  })
  .meta({ id: 'StudentPoints' });
export type StudentPoints = z.infer<typeof StudentPoints>;

export const PointEvidenceLink = z.object({ url: z.url(), expiresAt: z.iso.datetime({ offset: true }) }).meta({ id: 'PointEvidenceLink' });
export type PointEvidenceLink = z.infer<typeof PointEvidenceLink>;
