import { z } from 'zod';
import { PresignedUpload } from '../academic/imports';
import { PhoneNumberId } from '../platform/invitations';
import { VISITOR_PHOTO_MAX_BYTES, VISITOR_PHOTO_TYPE } from './visitors';

/**
 * Penjemput resmi (GRB-09, behind gate.pickup): the people allowed to take a student home. A parent
 * registers them from the portal (pending) and the wali kelas or admin approves; staff entries are
 * approved at once. The photo is what the kiosk shows at check-out.
 */
export const PICKUP_PHOTO_TYPE = VISITOR_PHOTO_TYPE;
export const PICKUP_PHOTO_MAX_BYTES = VISITOR_PHOTO_MAX_BYTES;
/** A photo is removed this many days after its penjemput was rejected or deactivated. */
export const PICKUP_PHOTO_RETENTION_DAYS = 30;
/** Pending and approved penjemput per student. */
export const PICKUP_GUARDIANS_MAX = 6;

export const PICKUP_RELATIONS = ['ayah', 'ibu', 'kakek', 'nenek', 'kakak', 'paman', 'bibi', 'sopir', 'lainnya'] as const;
export const PickupRelation = z.enum(PICKUP_RELATIONS).meta({ id: 'PickupRelation' });
export type PickupRelation = z.infer<typeof PickupRelation>;

export const PICKUP_GUARDIAN_STATUSES = ['pending', 'approved', 'rejected', 'inactive'] as const;
export const PickupGuardianStatus = z.enum(PICKUP_GUARDIAN_STATUSES).meta({ id: 'PickupGuardianStatus' });
export type PickupGuardianStatus = z.infer<typeof PickupGuardianStatus>;

/** POST /api/v1/pickup-guardian-photos: a presigned PUT for the penjemput's photo (JPEG). */
export const CreatePickupPhotoRequest = z
  .object({
    studentId: z.uuid(),
    fileSize: z.int().positive().max(PICKUP_PHOTO_MAX_BYTES, 'Foto maksimal 2 MB.'),
    contentType: z.literal(PICKUP_PHOTO_TYPE),
  })
  .strict()
  .meta({ id: 'CreatePickupPhotoRequest' });
export type CreatePickupPhotoRequest = z.infer<typeof CreatePickupPhotoRequest>;

export const CreatePickupPhotoResponse = z.object({ photoId: z.uuid(), upload: PresignedUpload }).meta({ id: 'CreatePickupPhotoResponse' });
export type CreatePickupPhotoResponse = z.infer<typeof CreatePickupPhotoResponse>;

/** POST /api/v1/students/{studentId}/pickup-guardians. */
export const CreatePickupGuardianRequest = z
  .object({
    name: z.string().trim().min(1, 'Tulis nama penjemput.').max(100),
    relation: PickupRelation,
    phone: PhoneNumberId,
    /** photoId from POST /pickup-guardian-photos, after the JPEG was PUT. */
    photoId: z.uuid(),
    /** Last day the penjemput may pick up (e.g. a driver for one semester); none = until deactivated. */
    validUntil: z.iso.date().optional(),
  })
  .strict()
  .meta({ id: 'CreatePickupGuardianRequest' });
export type CreatePickupGuardianRequest = z.infer<typeof CreatePickupGuardianRequest>;

export const PickupGuardian = z
  .object({
    id: z.uuid(),
    studentId: z.uuid(),
    studentName: z.string(),
    className: z.string().nullable(),
    name: z.string(),
    relation: PickupRelation,
    /** Masked ("+62812****7890"). */
    phone: z.string(),
    status: PickupGuardianStatus,
    validUntil: z.iso.date().nullable(),
    /** A photo is stored; only the wali kelas, piket and admin may open it. */
    hasPhoto: z.boolean(),
    registeredAt: z.iso.datetime({ offset: true }),
    decidedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .meta({ id: 'PickupGuardian' });
export type PickupGuardian = z.infer<typeof PickupGuardian>;

export const PickupGuardianList = z.object({ items: z.array(PickupGuardian) }).meta({ id: 'PickupGuardianList' });
export type PickupGuardianList = z.infer<typeof PickupGuardianList>;

/** GET /api/v1/pickup-guardians?status=pending: the approval queue (wali kelas: own rombel; admin: all). */
export const PickupGuardiansQuery = z.object({ status: PickupGuardianStatus.default('pending') }).meta({ id: 'PickupGuardiansQuery' });
export type PickupGuardiansQuery = z.infer<typeof PickupGuardiansQuery>;

/** POST /api/v1/pickup-guardians/{id}/{approve|reject|deactivate}. */
export const PICKUP_GUARDIAN_ACTIONS = ['approve', 'reject', 'deactivate'] as const;
export const PickupGuardianActionParam = z.object({ pickupGuardianId: z.uuid(), action: z.enum(PICKUP_GUARDIAN_ACTIONS) });

export const PickupGuardianIdParam = z.object({ pickupGuardianId: z.uuid() });

/** GET /api/v1/pickup-guardians/{id}/photo: a 5-minute link (audited). */
export const PickupPhotoLink = z.object({ url: z.url(), expiresAt: z.iso.datetime({ offset: true }) }).meta({ id: 'PickupPhotoLink' });
export type PickupPhotoLink = z.infer<typeof PickupPhotoLink>;

/**
 * Check-out (GRB-10). The kiosk keeps each student's approved penjemput from the morning sync (photos
 * downloaded at once from the 5-minute links) so it can release a student offline.
 */
export const KioskPickupStudent = z
  .object({
    cardId: z.uuid(),
    guardians: z.array(z.object({ id: z.uuid(), name: z.string(), relation: PickupRelation, photoUrl: z.url() })),
  })
  .meta({ id: 'KioskPickupStudent' });
export type KioskPickupStudent = z.infer<typeof KioskPickupStudent>;

export const PICKUP_EVENT_STATUSES = ['released', 'held', 'denied', 'expired'] as const;
export const PickupEventStatus = z.enum(PICKUP_EVENT_STATUSES).meta({ id: 'PickupEventStatus' });
export type PickupEventStatus = z.infer<typeof PickupEventStatus>;

export const KIOSK_CHECKOUT_BATCH_MAX = 200;

/** POST /api/v1/kiosk/checkouts: queued check-outs with a listed penjemput, exactly once per clientEventId. */
export const KioskCheckoutBatch = z
  .object({
    checkouts: z
      .array(
        z
          .object({
            clientEventId: z.uuid(),
            /** The card token as scanned. */
            token: z.string().max(200),
            pickupGuardianId: z.uuid(),
            checkedOutAt: z.iso.datetime({ offset: true }),
          })
          .strict(),
      )
      .min(1)
      .max(KIOSK_CHECKOUT_BATCH_MAX),
  })
  .strict()
  .meta({ id: 'KioskCheckoutBatch' });
export type KioskCheckoutBatch = z.infer<typeof KioskCheckoutBatch>;

/** The card reasons of a scan, plus not_authorized: the penjemput is not an approved one of this student. */
export const CHECKOUT_REJECT_REASONS = ['malformed', 'expired', 'no_key', 'bad_signature', 'unknown_card', 'wrong_device', 'not_enrolled', 'not_authorized'] as const;
export const CheckoutRejectReason = z.enum(CHECKOUT_REJECT_REASONS).meta({ id: 'CheckoutRejectReason' });
export type CheckoutRejectReason = z.infer<typeof CheckoutRejectReason>;

/** released: recorded (parents told); duplicate: the student was already released today. */
export const KioskCheckoutResult = z
  .object({
    clientEventId: z.uuid(),
    result: z.enum(['released', 'duplicate', 'rejected']),
    rejectReason: CheckoutRejectReason.nullable(),
    firstName: z.string().nullable(),
  })
  .meta({ id: 'KioskCheckoutResult' });
export type KioskCheckoutResult = z.infer<typeof KioskCheckoutResult>;

export const KioskCheckoutResults = z.object({ results: z.array(KioskCheckoutResult) }).meta({ id: 'KioskCheckoutResults' });
export type KioskCheckoutResults = z.infer<typeof KioskCheckoutResults>;

/**
 * Unlisted penjemput (GRB-10): the kiosk takes a name and a photo and holds the student until a
 * parent allows it through the action link or the wali kelas (or admin) does. Online only.
 */
export const CreateKioskPickupPhotoRequest = z
  .object({ fileSize: z.int().positive().max(PICKUP_PHOTO_MAX_BYTES, 'Foto maksimal 2 MB.'), contentType: z.literal(PICKUP_PHOTO_TYPE) })
  .strict()
  .meta({ id: 'CreateKioskPickupPhotoRequest' });
export type CreateKioskPickupPhotoRequest = z.infer<typeof CreateKioskPickupPhotoRequest>;

/** POST /api/v1/kiosk/unlisted-pickups: exactly once per clientEventId. */
export const KioskUnlistedPickupRequest = z
  .object({
    clientEventId: z.uuid(),
    token: z.string().max(200),
    name: z.string().trim().min(1, 'Tulis nama penjemput.').max(100),
    /** photoId from POST /kiosk/pickup-photos, after the JPEG was PUT. */
    photoId: z.uuid(),
    requestedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .meta({ id: 'KioskUnlistedPickupRequest' });
export type KioskUnlistedPickupRequest = z.infer<typeof KioskUnlistedPickupRequest>;

export const PICKUP_DECIDERS = ['guardian', 'staff'] as const;
export const PickupDecider = z.enum(PICKUP_DECIDERS).meta({ id: 'PickupDecider' });

/** What the kiosk polls while it holds a student (GET /kiosk/unlisted-pickups/{id}). */
export const KioskUnlistedPickup = z
  .object({
    id: z.uuid(),
    status: PickupEventStatus,
    firstName: z.string(),
    pickupName: z.string(),
    decidedVia: PickupDecider.nullable(),
  })
  .meta({ id: 'KioskUnlistedPickup' });
export type KioskUnlistedPickup = z.infer<typeof KioskUnlistedPickup>;

export const PickupEventIdParam = z.object({ pickupEventId: z.uuid() });

/** A check-out as staff see it (GET /pickups). */
export const PickupEvent = z
  .object({
    id: z.uuid(),
    schoolDate: z.iso.date(),
    studentId: z.uuid(),
    studentName: z.string(),
    className: z.string().nullable(),
    pickupName: z.string(),
    /** false: an unlisted penjemput (name and photo taken at the kiosk). */
    listed: z.boolean(),
    status: PickupEventStatus,
    requestedAt: z.iso.datetime({ offset: true }),
    checkedOutAt: z.iso.datetime({ offset: true }).nullable(),
    decidedVia: PickupDecider.nullable(),
    decidedAt: z.iso.datetime({ offset: true }).nullable(),
    /** An unlisted penjemput's photo is still stored. */
    hasPhoto: z.boolean(),
  })
  .meta({ id: 'PickupEvent' });
export type PickupEvent = z.infer<typeof PickupEvent>;

/** GET /api/v1/pickups?date=: the day's check-outs, held first (piket, admin, kepsek...: all; a wali kelas: own rombel). */
export const PickupEventsQuery = z.object({ date: z.iso.date().optional() }).meta({ id: 'PickupEventsQuery' });
export type PickupEventsQuery = z.infer<typeof PickupEventsQuery>;

export const PickupEventList = z.object({ schoolDate: z.iso.date(), items: z.array(PickupEvent) }).meta({ id: 'PickupEventList' });
export type PickupEventList = z.infer<typeof PickupEventList>;

/** POST /api/v1/pickups/{id}/{allow|deny} (wali kelas, admin) and POST /api/v1/links/pickups/{id} (parent). */
export const PICKUP_DECISIONS = ['allow', 'deny'] as const;
export const PickupDecision = z.enum(PICKUP_DECISIONS).meta({ id: 'PickupDecision' });
export type PickupDecision = z.infer<typeof PickupDecision>;
export const PickupEventActionParam = z.object({ pickupEventId: z.uuid(), action: PickupDecision });
export const LinkPickupDecisionRequest = z.object({ decision: PickupDecision }).strict().meta({ id: 'LinkPickupDecisionRequest' });
export type LinkPickupDecisionRequest = z.infer<typeof LinkPickupDecisionRequest>;

/** A held request as the parent sees it on the action link page. */
export const LinkHeldPickup = z
  .object({ id: z.uuid(), pickupName: z.string(), requestedAt: z.iso.datetime({ offset: true }), status: PickupEventStatus })
  .meta({ id: 'LinkHeldPickup' });
export type LinkHeldPickup = z.infer<typeof LinkHeldPickup>;

/** POST /api/v1/links/pickups/{id}: today's requests after the decision. */
export const LinkHeldPickups = z.object({ pickups: z.array(LinkHeldPickup) }).meta({ id: 'LinkHeldPickups' });
export type LinkHeldPickups = z.infer<typeof LinkHeldPickups>;
