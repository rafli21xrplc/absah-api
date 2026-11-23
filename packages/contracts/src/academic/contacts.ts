import { z } from 'zod';
import { PhoneNumberId } from '../platform/invitations';
import { GuardianRelation } from './enums';

/** "+6281234567890" -> "+62812****7890": how screens and logs show a WhatsApp number. */
export function maskPhone(phone: string): string {
  return phone.length <= 8 ? '****' : `${phone.slice(0, 6)}****${phone.slice(-4)}`;
}

/**
 * GET /api/v1/students/{studentId}/contacts: WhatsApp numbers of a student and their guardians
 * (masked). Guardian numbers receive notifications and action links (NTF, ORT-01); the student's
 * number is their login for the PWA siswa (OTP, ORT-02).
 */
export const StudentContacts = z
  .object({
    studentId: z.uuid(),
    name: z.string(),
    className: z.string().nullable(),
    account: z.object({ phone: z.string().nullable(), active: z.boolean() }),
    guardians: z.array(z.object({ id: z.uuid(), name: z.string(), relation: GuardianRelation, phone: z.string().nullable() })),
  })
  .meta({ id: 'StudentContacts' });
export type StudentContacts = z.infer<typeof StudentContacts>;

/**
 * PUT /api/v1/students/{studentId}/contacts: only the fields sent change. A student number creates
 * (or moves) the student's login and makes them a siswa member; null ends their access. A guardian
 * number null stops their messages.
 */
export const UpdateStudentContactsRequest = z
  .object({
    studentPhone: PhoneNumberId.nullable().optional(),
    guardians: z.array(z.object({ guardianId: z.uuid(), phone: PhoneNumberId.nullable() }).strict()).max(5).optional(),
  })
  .strict()
  .meta({ id: 'UpdateStudentContactsRequest' });
export type UpdateStudentContactsRequest = z.infer<typeof UpdateStudentContactsRequest>;

export const StudentIdParam = z.object({ studentId: z.uuid() });
