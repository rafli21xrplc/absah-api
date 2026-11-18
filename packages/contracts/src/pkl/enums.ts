import { z } from 'zod';

/**
 * PKL (SMK, pkl.enabled): placements at industry partners (DUDI), check-ins from the student's phone,
 * confirmation by the industry supervisor, review by the school supervisor, daily journals.
 */

/** Default geofence around a DUDI, in metres (PKL-01). */
export const PKL_DEFAULT_RADIUS_M = 150;
export const PKL_MIN_RADIUS_M = 25;
export const PKL_MAX_RADIUS_M = 2000;
/** Device clock further than this from the server clock sends a check-in to review (PKL-02). */
export const PKL_MAX_CLOCK_SKEW_SECONDS = 10 * 60;
/** A check-in may come this long before the DUDI opens and still count as within working hours. */
export const PKL_EARLY_CHECKIN_MINUTES = 60;
/** pkl.auto-confirm confirms pending check-ins nobody disputed within this many hours. */
export const PKL_AUTO_CONFIRM_HOURS = 24;

/** Cancelled placements keep their history; a placement simply ends after ends_on. */
export const PKL_PLACEMENT_STATUSES = ['active', 'cancelled'] as const;
export const PklPlacementStatus = z.enum(PKL_PLACEMENT_STATUSES).meta({ id: 'PklPlacementStatus' });
export type PklPlacementStatus = z.infer<typeof PklPlacementStatus>;

export const PKL_CHECKIN_KINDS = ['in', 'out'] as const;
export const PklCheckinKind = z.enum(PKL_CHECKIN_KINDS).meta({ id: 'PklCheckinKind' });
export type PklCheckinKind = z.infer<typeof PklCheckinKind>;

/**
 * Only check-ins (kind in) are confirmed:
 * - pending: inside the radius and working hours, waiting for the industry supervisor
 * - confirmed: by the industry supervisor or by pkl.auto-confirm after 24 hours
 * - needs_review: outside the radius or hours, clock skew, or no industry supervisor: school supervisor decides
 * - disputed: the industry supervisor disputed it: school supervisor decides
 * - decided: the school supervisor decided (the attendance status is on the row)
 */
export const PKL_CONFIRM_STATUSES = ['pending', 'confirmed', 'needs_review', 'disputed', 'decided'] as const;
export const PklConfirmStatus = z.enum(PKL_CONFIRM_STATUSES).meta({ id: 'PklConfirmStatus' });
export type PklConfirmStatus = z.infer<typeof PklConfirmStatus>;

/** Why a check-in went to the school supervisor instead of the industry supervisor. */
export const PKL_REVIEW_REASONS = ['outside_radius', 'outside_hours', 'clock_skew', 'no_industry_mentor'] as const;
export const PklReviewReason = z.enum(PKL_REVIEW_REASONS).meta({ id: 'PklReviewReason' });
export type PklReviewReason = z.infer<typeof PklReviewReason>;

export const PKL_JOURNAL_STATUSES = ['submitted', 'approved', 'revision'] as const;
export const PklJournalStatus = z.enum(PKL_JOURNAL_STATUSES).meta({ id: 'PklJournalStatus' });
export type PklJournalStatus = z.infer<typeof PklJournalStatus>;
