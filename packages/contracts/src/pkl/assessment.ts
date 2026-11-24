import { z } from 'zod';

/**
 * Penilaian DUDI (PKL-04): the aspects a school grades its PKL students on (set by humas PKL, wakasek, admin), and the form the
 * pembimbing industri fills at the end of the period (prompt 6.2b).
 */

export const PKL_ASPECT_MAX = 12;
export const PKL_ASPECT_WEIGHT_MAX = 10;
export const PKL_SCORE_MAX = 100;

export const PklAssessmentAspect = z
  .object({
    id: z.uuid(),
    name: z.string(),
    description: z.string().nullable(),
    /** 1..10: the share of this aspect in the weighted score. */
    weight: z.int().min(1).max(PKL_ASPECT_WEIGHT_MAX),
  })
  .meta({ id: 'PklAssessmentAspect' });
export type PklAssessmentAspect = z.infer<typeof PklAssessmentAspect>;

/** Active aspects in the order the form shows them. */
export const PklAssessmentAspectList = z.object({ items: z.array(PklAssessmentAspect) }).meta({ id: 'PklAssessmentAspectList' });
export type PklAssessmentAspectList = z.infer<typeof PklAssessmentAspectList>;

/**
 * PUT /api/v1/pkl/assessment-aspects: the whole list in form order. An item with an id edits that aspect, one without adds a new
 * one, an existing aspect left out is retired (assessments already given keep their own copy of its name and weight).
 */
export const SavePklAspectsRequest = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.uuid().optional(),
            name: z.string().trim().min(2, 'Nama aspek minimal 2 huruf.').max(80),
            description: z.string().trim().max(300).nullish(),
            weight: z.int().min(1).max(PKL_ASPECT_WEIGHT_MAX).default(1),
          })
          .strict(),
      )
      .min(1, 'Isi minimal satu aspek.')
      .max(PKL_ASPECT_MAX),
  })
  .strict()
  .meta({ id: 'SavePklAspectsRequest' });
export type SavePklAspectsRequest = z.infer<typeof SavePklAspectsRequest>;

/** The form is open from this many days before the placement ends until this many days after it ended. */
export const PKL_ASSESSMENT_OPEN_BEFORE_DAYS = 14;
export const PKL_ASSESSMENT_OPEN_AFTER_DAYS = 30;

export const PKL_ASSESSMENT_WINDOWS = ['not_yet', 'open', 'closed'] as const;
export const PklAssessmentWindow = z.enum(PKL_ASSESSMENT_WINDOWS).meta({ id: 'PklAssessmentWindow' });
export type PklAssessmentWindow = z.infer<typeof PklAssessmentWindow>;

export const PklAssessmentScore = z.object({
  aspectId: z.uuid(),
  /** Name and weight as they were when the score was given. */
  aspectName: z.string(),
  weight: z.int(),
  score: z.int().min(0).max(PKL_SCORE_MAX),
});
export type PklAssessmentScore = z.infer<typeof PklAssessmentScore>;

export const PklAssessment = z
  .object({
    /** Weighted average of the scores, one decimal. */
    overall: z.number().min(0).max(PKL_SCORE_MAX),
    note: z.string().nullable(),
    assessedAt: z.iso.datetime({ offset: true }),
    scores: z.array(PklAssessmentScore),
  })
  .meta({ id: 'PklAssessment' });
export type PklAssessment = z.infer<typeof PklAssessment>;

/** One placement with its assessment state (null: not given yet). */
export const PklAssessmentItem = z
  .object({
    placementId: z.uuid(),
    student: z.object({ name: z.string(), className: z.string() }),
    partner: z.object({ id: z.uuid(), name: z.string() }),
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
    window: PklAssessmentWindow,
    assessment: PklAssessment.nullable(),
  })
  .meta({ id: 'PklAssessmentItem' });
export type PklAssessmentItem = z.infer<typeof PklAssessmentItem>;

/** GET /api/v1/pkl/assessments: a pembimbing industri their own students, a guru pembimbing theirs, managers and kepsek all. */
export const PklAssessmentList = z.object({ items: z.array(PklAssessmentItem) }).meta({ id: 'PklAssessmentList' });
export type PklAssessmentList = z.infer<typeof PklAssessmentList>;

/** GET one: the item plus the aspects the form asks for now. */
export const PklAssessmentForm = PklAssessmentItem.extend({ aspects: z.array(PklAssessmentAspect) }).meta({ id: 'PklAssessmentForm' });
export type PklAssessmentForm = z.infer<typeof PklAssessmentForm>;

/** PUT /api/v1/pkl/placements/{placementId}/assessment: one score per current aspect (all of them). The pembimbing industri of the placement. */
export const SavePklAssessmentRequest = z
  .object({
    scores: z.array(z.object({ aspectId: z.uuid(), score: z.int().min(0).max(PKL_SCORE_MAX) }).strict()).min(1).max(PKL_ASPECT_MAX),
    note: z.string().trim().max(1000).nullish(),
  })
  .strict()
  .meta({ id: 'SavePklAssessmentRequest' });
export type SavePklAssessmentRequest = z.infer<typeof SavePklAssessmentRequest>;

/** GET /api/v1/pkl/assessments/export?format=xlsx|pdf: the results as a file (not for the industry supervisors); partnerId limits it to one DUDI. */
export const PklAssessmentExportQuery = z.object({ format: z.enum(['xlsx', 'pdf']), partnerId: z.uuid().optional() }).meta({ id: 'PklAssessmentExportQuery' });
export type PklAssessmentExportQuery = z.infer<typeof PklAssessmentExportQuery>;
