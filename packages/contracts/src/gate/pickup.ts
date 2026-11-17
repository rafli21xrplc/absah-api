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
