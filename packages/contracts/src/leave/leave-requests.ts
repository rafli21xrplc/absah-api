import { z } from 'zod';
import { PresignedUpload } from '../academic/imports';

/** Student leave requests (IZN). docs/architecture.md: wali kelas decides, attendance fills S/I. */

export const LEAVE_KINDS = ['sakit', 'izin'] as const;
export const LeaveKind = z.enum(LEAVE_KINDS).meta({ id: 'LeaveKind' });
export type LeaveKind = z.infer<typeof LeaveKind>;

export const LEAVE_STATUSES = ['pending', 'approved', 'rejected', 'cancelled'] as const;
export const LeaveStatus = z.enum(LEAVE_STATUSES).meta({ id: 'LeaveStatus' });
export type LeaveStatus = z.infer<typeof LeaveStatus>;

/** Longest izin in one request (inclusive days) and how far back it may start. */
export const LEAVE_MAX_DAYS = 30;
export const LEAVE_MAX_BACKDATE_DAYS = 7;
export const LEAVE_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const LEAVE_ATTACHMENT_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'] as const;
export const LeaveAttachmentType = z.enum(LEAVE_ATTACHMENT_TYPES).meta({ id: 'LeaveAttachmentType' });

/** POST /api/v1/leave-requests/attachments: a presigned PUT for a letter or photo (surat dokter). */
export const CreateLeaveAttachmentRequest = z
  .object({ fileSize: z.int().positive().max(LEAVE_ATTACHMENT_MAX_BYTES, 'Lampiran maksimal 5 MB.'), contentType: LeaveAttachmentType })
  .strict()
  .meta({ id: 'CreateLeaveAttachmentRequest' });
export type CreateLeaveAttachmentRequest = z.infer<typeof CreateLeaveAttachmentRequest>;

export const CreateLeaveAttachmentResponse = z
  .object({ attachmentId: z.uuid(), upload: PresignedUpload })
  .meta({ id: 'CreateLeaveAttachmentResponse' });
export type CreateLeaveAttachmentResponse = z.infer<typeof CreateLeaveAttachmentResponse>;

/** POST /api/v1/leave-requests: by a parent (pending) or the wali kelas on their behalf (approved at once). */
export const CreateLeaveRequest = z
  .object({
    enrollmentId: z.uuid(),
    kind: LeaveKind,
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
    reason: z.string().trim().min(3, 'Tulis alasan izin.').max(500),
    attachment: z.object({ id: z.uuid(), contentType: LeaveAttachmentType }).strict().optional(),
  })
  .strict()
  .meta({ id: 'CreateLeaveRequest' });
export type CreateLeaveRequest = z.infer<typeof CreateLeaveRequest>;

const Ref = z.object({ id: z.uuid(), name: z.string() });

export const LeaveRequest = z
  .object({
    id: z.uuid(),
    student: z.object({ enrollmentId: z.uuid(), name: z.string(), className: z.string() }),
    kind: LeaveKind,
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
    reason: z.string(),
    hasAttachment: z.boolean(),
    status: LeaveStatus,
    requestedBy: Ref.nullable(),
    decidedBy: Ref.nullable(),
    decidedAt: z.iso.datetime({ offset: true }).nullable(),
    decisionNote: z.string().nullable(),
    cancelledAt: z.iso.datetime({ offset: true }).nullable(),
    createdAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'LeaveRequest' });
export type LeaveRequest = z.infer<typeof LeaveRequest>;

export const LeaveRequestList = z.object({ items: z.array(LeaveRequest) }).meta({ id: 'LeaveRequestList' });
export type LeaveRequestList = z.infer<typeof LeaveRequestList>;

/** GET /api/v1/leave-requests: wakasek/kepsek see all; wali kelas their rombel; parents their children. */
export const LeaveRequestListQuery = z
  .object({ status: z.enum([...LEAVE_STATUSES, 'all']).default('pending') })
  .meta({ id: 'LeaveRequestListQuery' });
export type LeaveRequestListQuery = z.infer<typeof LeaveRequestListQuery>;

export const LeaveRequestIdParam = z.object({ leaveRequestId: z.uuid() });

export const DecideLeaveRequest = z
  .object({ approve: z.boolean(), note: z.string().trim().max(300).optional() })
  .strict()
  .meta({ id: 'DecideLeaveRequest' });
export type DecideLeaveRequest = z.infer<typeof DecideLeaveRequest>;

export const LeaveAttachmentLink = z
  .object({ url: z.url(), expiresAt: z.iso.datetime({ offset: true }) })
  .meta({ id: 'LeaveAttachmentLink' });
export type LeaveAttachmentLink = z.infer<typeof LeaveAttachmentLink>;

/** GET /api/v1/leave-requests/students: whom the caller may request leave for. */
export const LeaveStudentList = z
  .object({ items: z.array(z.object({ enrollmentId: z.uuid(), name: z.string(), className: z.string() })) })
  .meta({ id: 'LeaveStudentList' });
export type LeaveStudentList = z.infer<typeof LeaveStudentList>;
