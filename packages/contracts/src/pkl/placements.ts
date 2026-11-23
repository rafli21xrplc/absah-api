import { z } from 'zod';
import { PhoneNumberId } from '../platform/invitations';
import { PklPlacementStatus } from './enums';

/**
 * PKL placements (PKL-01): one student at one DUDI for a period, with a guru pembimbing (school
 * staff) and a pembimbing industri (phone account, WhatsApp OTP; access ends with the placements).
 */

const Person = z.object({ id: z.uuid(), name: z.string() });

export const PklPlacement = z
  .object({
    id: z.uuid(),
    student: z.object({ studentId: z.uuid(), enrollmentId: z.uuid(), name: z.string(), className: z.string() }),
    partner: Person,
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
    status: PklPlacementStatus,
    /** Today is inside the period and the placement is not cancelled. */
    current: z.boolean(),
    schoolMentor: Person.nullable(),
    /** phone is masked (+62 812-****-7890). */
    industryMentor: Person.extend({ phone: z.string().nullable() }).nullable(),
  })
  .meta({ id: 'PklPlacement' });
export type PklPlacement = z.infer<typeof PklPlacement>;

export const PklPlacementList = z.object({ items: z.array(PklPlacement) }).meta({ id: 'PklPlacementList' });
export type PklPlacementList = z.infer<typeof PklPlacementList>;

/** The pembimbing industri: an existing account with this number is reused, else one is created. */
export const IndustryMentorInput = z
  .object({ name: z.string().trim().min(2, 'Tulis nama pembimbing industri.').max(100), phoneNumber: PhoneNumberId })
  .strict()
  .meta({ id: 'IndustryMentorInput' });
export type IndustryMentorInput = z.infer<typeof IndustryMentorInput>;

const MAX_DAYS = 366;
const periodOk = (v: { startsOn?: string; endsOn?: string }) => !v.startsOn || !v.endsOn || v.startsOn <= v.endsOn;
const periodShort = (v: { startsOn?: string; endsOn?: string }) =>
  !v.startsOn || !v.endsOn || (Date.parse(v.endsOn) - Date.parse(v.startsOn)) / 86_400_000 < MAX_DAYS;

/**
 * POST /api/v1/pkl/placements (managers): several students at one DUDI with the same period and
 * supervisors (a typical PKL batch). The period must not end before today; overlapping placements
 * of a student answer 409 overlap with details.enrollmentIds.
 */
export const CreatePklPlacementsRequest = z
  .object({
    enrollmentIds: z
      .array(z.uuid())
      .min(1, 'Pilih minimal satu siswa.')
      .max(40)
      .refine((ids) => new Set(ids).size === ids.length, 'Siswa tidak boleh ganda.'),
    partnerId: z.uuid(),
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
    schoolMentorId: z.uuid(),
    industryMentor: IndustryMentorInput.nullable().default(null),
  })
  .strict()
  .refine(periodOk, { message: 'Tanggal selesai tidak boleh sebelum tanggal mulai.', path: ['endsOn'] })
  .refine(periodShort, { message: 'Periode PKL paling lama satu tahun.', path: ['endsOn'] })
  .meta({ id: 'CreatePklPlacementsRequest' });
export type CreatePklPlacementsRequest = z.input<typeof CreatePklPlacementsRequest>;

/** PATCH /api/v1/pkl/placements/{placementId} (managers): fields left out stay; industryMentor null removes them. */
export const UpdatePklPlacementRequest = z
  .object({ endsOn: z.iso.date(), schoolMentorId: z.uuid(), industryMentor: IndustryMentorInput.nullable() })
  .partial()
  .strict()
  .meta({ id: 'UpdatePklPlacementRequest' });
export type UpdatePklPlacementRequest = z.infer<typeof UpdatePklPlacementRequest>;

export const PklPlacementIdParam = z.object({ placementId: z.uuid() });

/** GET /api/v1/pkl/placements: managers see all, a guru pembimbing their own. */
export const PklPlacementQuery = z.object({
  partnerId: z.uuid().optional(),
  /** current (default): running today or later, not cancelled; all: every placement. */
  scope: z.enum(['current', 'all']).default('current'),
});
