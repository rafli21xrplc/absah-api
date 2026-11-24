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
