import { z } from 'zod';

/**
 * Point thresholds and follow-up tasks (KSW-03, behind student.points). A threshold is a tier on the
 * net pelanggaran points of a student's year ("25 poin: panggil orang tua"). When a recorded pelanggaran
 * takes the total across a tier, the student gets one follow-up task for that tier (once per student per
 * year), and the parents are told in generic words when the tier asks for it. Tiers are switched off,
 * never deleted: tasks cite them.
 */
export const POINT_THRESHOLD_MAX_POINTS = 1000;

const ThresholdFields = z.object({
  minPoints: z.int().min(1).max(POINT_THRESHOLD_MAX_POINTS),
  label: z.string().trim().min(2, 'Tulis nama tingkat.').max(60),
  action: z.string().trim().min(2, 'Tulis tindak lanjutnya.').max(200),
  notifyParents: z.boolean(),
});

/** POST /api/v1/point-thresholds (admin, wakasek). */
export const CreatePointThresholdRequest = ThresholdFields.strict().meta({ id: 'CreatePointThresholdRequest' });
export type CreatePointThresholdRequest = z.infer<typeof CreatePointThresholdRequest>;

/** PUT /api/v1/point-thresholds/{thresholdId}: fields left out stay. */
export const UpdatePointThresholdRequest = ThresholdFields.extend({ active: z.boolean() }).partial().strict().meta({ id: 'UpdatePointThresholdRequest' });
export type UpdatePointThresholdRequest = z.infer<typeof UpdatePointThresholdRequest>;

export const PointThresholdIdParam = z.object({ thresholdId: z.uuid() });

export const PointThreshold = z
  .object({ id: z.uuid(), minPoints: z.number().int(), label: z.string(), action: z.string(), notifyParents: z.boolean(), active: z.boolean() })
  .meta({ id: 'PointThreshold' });
export type PointThreshold = z.infer<typeof PointThreshold>;

/** GET /api/v1/point-thresholds[?all=true]: ascending by points; all=true adds the switched-off ones (admin, wakasek). */
export const PointThresholdsQuery = z.object({ all: z.stringbool().optional() }).meta({ id: 'PointThresholdsQuery' });
export type PointThresholdsQuery = z.infer<typeof PointThresholdsQuery>;

export const PointThresholdList = z.object({ items: z.array(PointThreshold) }).meta({ id: 'PointThresholdList' });
export type PointThresholdList = z.infer<typeof PointThresholdList>;

export const FOLLOWUP_STATUSES = ['open', 'done'] as const;
export const FollowupStatus = z.enum(FOLLOWUP_STATUSES).meta({ id: 'FollowupStatus' });
export type FollowupStatus = z.infer<typeof FollowupStatus>;

export const FollowupTask = z
  .object({
    id: z.uuid(),
    student: z.object({ enrollmentId: z.uuid(), name: z.string(), className: z.string() }),
    /** What the tier said when it was crossed (a copy, so editing the tier later changes nothing here). */
    label: z.string(),
    action: z.string(),
    minPoints: z.number().int(),
    /** The student's net pelanggaran points (as a positive number) when the tier was crossed. */
    totalPoints: z.number().int(),
    status: FollowupStatus,
    createdAt: z.iso.datetime(),
    completedAt: z.iso.datetime().nullable(),
    completedBy: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    note: z.string().nullable(),
  })
  .meta({ id: 'FollowupTask' });
export type FollowupTask = z.infer<typeof FollowupTask>;

/** GET /api/v1/followup-tasks[?status=open|done]: newest first, at most 200. */
export const FollowupTasksQuery = z.object({ status: FollowupStatus.optional() }).meta({ id: 'FollowupTasksQuery' });
export type FollowupTasksQuery = z.infer<typeof FollowupTasksQuery>;

export const FollowupTaskList = z.object({ items: z.array(FollowupTask) }).meta({ id: 'FollowupTaskList' });
export type FollowupTaskList = z.infer<typeof FollowupTaskList>;

export const FollowupTaskIdParam = z.object({ taskId: z.uuid() });

/** POST /api/v1/followup-tasks/{taskId}/complete: what was done (kept encrypted). */
export const CompleteFollowupRequest = z.object({ note: z.string().trim().max(500).optional() }).strict().meta({ id: 'CompleteFollowupRequest' });
export type CompleteFollowupRequest = z.infer<typeof CompleteFollowupRequest>;
