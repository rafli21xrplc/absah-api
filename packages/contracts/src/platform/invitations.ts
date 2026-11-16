import { z } from 'zod';
import { Role, StaffRole } from './roles';

/** Indonesian mobile number in E.164 (+628...), the format WhatsApp OTP uses. */
export const PhoneNumberId = z.string().regex(/^\+628\d{7,12}$/, 'Nomor WhatsApp harus diawali +628.');

/**
 * POST /api/v1/school/invitations (admin): invite a staff member by email (logs in with a
 * password) or WhatsApp number (logs in with an OTP). Exactly one of email / phoneNumber.
 */
export const CreateInvitationRequest = z
  .object({
    name: z.string().trim().min(2, 'Nama minimal 2 huruf.').max(120),
    email: z.email('Email tidak valid.').toLowerCase().optional(),
    phoneNumber: PhoneNumberId.optional(),
    role: StaffRole,
  })
  .strict()
  .refine((v) => (v.email === undefined) !== (v.phoneNumber === undefined), {
    message: 'Isi email atau nomor WhatsApp (salah satu).',
    path: ['email'],
  })
  .meta({ id: 'CreateInvitationRequest' });
export type CreateInvitationRequest = z.infer<typeof CreateInvitationRequest>;

export const InvitationResponse = z
  .object({
    membershipId: z.uuid(),
    role: Role,
    /** Share this link with the invitee (copy, or WhatsApp once notifications exist). Shown once. */
    inviteUrl: z.url(),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'InvitationResponse' });
export type InvitationResponse = z.infer<typeof InvitationResponse>;

/** The token travels in the body, never in a URL path, so it stays out of access logs. */
export const InvitationTokenRequest = z.object({ token: z.string().min(40).max(200) }).strict().meta({ id: 'InvitationTokenRequest' });

export const InvitationPreviewResponse = z
  .object({
    schoolName: z.string(),
    role: Role,
    name: z.string(),
    loginMethod: z.enum(['password', 'otp']),
    /** True when the invitee has no password yet and must choose one to accept. */
    needsPassword: z.boolean(),
  })
  .meta({ id: 'InvitationPreviewResponse' });
export type InvitationPreviewResponse = z.infer<typeof InvitationPreviewResponse>;

export const AcceptInvitationRequest = z
  .object({
    token: z.string().min(40).max(200),
    password: z.string().min(10, 'Kata sandi minimal 10 karakter.').max(128).optional(),
  })
  .strict()
  .meta({ id: 'AcceptInvitationRequest' });
export type AcceptInvitationRequest = z.infer<typeof AcceptInvitationRequest>;

export const AcceptInvitationResponse = z
  .object({ schoolId: z.uuid(), schoolName: z.string(), loginMethod: z.enum(['password', 'otp']) })
  .meta({ id: 'AcceptInvitationResponse' });
export type AcceptInvitationResponse = z.infer<typeof AcceptInvitationResponse>;
