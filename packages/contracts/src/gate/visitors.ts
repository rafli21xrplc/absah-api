import { z } from 'zod';
import { PresignedUpload } from '../academic/imports';

/** Buku tamu (GRB-11, behind gate.visitors): guests sign in at the kiosk, piket signs them out. */

/** The kiosk sends a JPEG it made from the camera (canvas.toBlob), so one type is enough. */
export const VISITOR_PHOTO_TYPE = 'image/jpeg';
export const VISITOR_PHOTO_MAX_BYTES = 2 * 1024 * 1024;
/** A photo is removed this many days after the guest left (or arrived, when nobody signed them out). */
export const VISITOR_PHOTO_RETENTION_DAYS = 30;

const Name = z.string().trim().min(1, 'Tulis nama tamu.').max(100);

/** POST /api/v1/kiosk/visitors. clientEventId makes a resend (flaky wifi) record one visit. */
export const CreateVisitorRequest = z
  .object({
    clientEventId: z.uuid(),
    name: Name,
    organization: z.string().trim().max(100).optional(),
    purpose: z.string().trim().min(1, 'Tulis tujuan kunjungan.').max(200),
    /** The staff member the guest came for; they are told on arrival. */
    hostUserId: z.uuid().optional(),
    /** photoId from POST /kiosk/visitor-photos, after the JPEG was PUT to the presigned URL. */
    photoId: z.uuid().optional(),
  })
  .strict()
  .meta({ id: 'CreateVisitorRequest' });
export type CreateVisitorRequest = z.infer<typeof CreateVisitorRequest>;

/** POST /api/v1/kiosk/visitor-photos: a presigned PUT for the guest's photo. */
export const CreateVisitorPhotoRequest = z
  .object({
    fileSize: z.int().positive().max(VISITOR_PHOTO_MAX_BYTES, 'Foto maksimal 2 MB.'),
    contentType: z.literal(VISITOR_PHOTO_TYPE),
  })
  .strict()
  .meta({ id: 'CreateVisitorPhotoRequest' });
export type CreateVisitorPhotoRequest = z.infer<typeof CreateVisitorPhotoRequest>;

export const CreateVisitorPhotoResponse = z
  .object({ photoId: z.uuid(), upload: PresignedUpload })
  .meta({ id: 'CreateVisitorPhotoResponse' });
export type CreateVisitorPhotoResponse = z.infer<typeof CreateVisitorPhotoResponse>;

/** GET /api/v1/visitors/{id}/photo: a 5-minute link to look at the photo. */
export const VisitorPhotoLink = z.object({ url: z.url(), expiresAt: z.iso.datetime({ offset: true }) }).meta({ id: 'VisitorPhotoLink' });
export type VisitorPhotoLink = z.infer<typeof VisitorPhotoLink>;

/** GET /api/v1/kiosk/visitor-hosts: the staff a guest can pick (id and name only). */
export const VisitorHostList = z
  .object({ items: z.array(z.object({ id: z.uuid(), name: z.string() })) })
  .meta({ id: 'VisitorHostList' });
export type VisitorHostList = z.infer<typeof VisitorHostList>;

export const Visitor = z
  .object({
    id: z.uuid(),
    schoolDate: z.iso.date(),
    name: z.string(),
    organization: z.string().nullable(),
    purpose: z.string(),
    host: z.object({ id: z.uuid(), name: z.string() }).nullable(),
    arrivedAt: z.iso.datetime({ offset: true }),
    /** Null while the guest is still on the premises. */
    leftAt: z.iso.datetime({ offset: true }).nullable(),
    /** A photo is stored and not yet removed by the retention job. */
    hasPhoto: z.boolean(),
  })
  .meta({ id: 'Visitor' });
export type Visitor = z.infer<typeof Visitor>;

/** GET /api/v1/visitors?date=&status=: the day's guests, newest first. */
export const VisitorsQuery = z
  .object({ date: z.iso.date().optional(), status: z.enum(['inside', 'all']).default('all') })
  .meta({ id: 'VisitorsQuery' });
export type VisitorsQuery = z.infer<typeof VisitorsQuery>;

export const VisitorList = z
  .object({ schoolDate: z.iso.date(), inside: z.int(), items: z.array(Visitor) })
  .meta({ id: 'VisitorList' });
export type VisitorList = z.infer<typeof VisitorList>;

export const VisitorIdParam = z.object({ visitorId: z.uuid() });
