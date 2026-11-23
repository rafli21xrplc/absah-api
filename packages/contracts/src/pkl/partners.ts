import { z } from 'zod';
import { SchoolDay } from '../academic/enums';
import { PKL_DEFAULT_RADIUS_M, PKL_MAX_RADIUS_M, PKL_MIN_RADIUS_M } from './enums';

/** Industry partners (DUDI, PKL-01). Managed by humas PKL, wakasek and admin. */

const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Format jam HH:MM.');

export const DudiWorkDay = z
  .object({ day: SchoolDay, startsAt: Clock, endsAt: Clock })
  .refine((d) => d.startsAt < d.endsAt, { message: 'Jam selesai harus setelah jam mulai.', path: ['endsAt'] })
  .meta({ id: 'DudiWorkDay' });
export type DudiWorkDay = z.infer<typeof DudiWorkDay>;

const WorkHours = z
  .array(DudiWorkDay)
  .min(1, 'Isi minimal satu hari kerja.')
  .max(7)
  .refine((days) => new Set(days.map((d) => d.day)).size === days.length, 'Hari kerja tidak boleh ganda.');

export const DudiPartner = z
  .object({
    id: z.uuid(),
    name: z.string(),
    address: z.string(),
    latitude: z.number(),
    longitude: z.number(),
    radiusM: z.number().int(),
    /** Sorted by day (1 = Senin); days not listed are closed. */
    workHours: z.array(DudiWorkDay),
    active: z.boolean(),
    /** Placements running today or later (not cancelled). */
    activePlacements: z.number().int(),
  })
  .meta({ id: 'DudiPartner' });
export type DudiPartner = z.infer<typeof DudiPartner>;

export const DudiPartnerList = z.object({ items: z.array(DudiPartner) }).meta({ id: 'DudiPartnerList' });
export type DudiPartnerList = z.infer<typeof DudiPartnerList>;

const PartnerFields = z.object({
  name: z.string().trim().min(2, 'Tulis nama DUDI.').max(150),
  address: z.string().trim().min(5, 'Tulis alamat DUDI.').max(300),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  radiusM: z
    .int()
    .min(PKL_MIN_RADIUS_M, `Radius minimal ${PKL_MIN_RADIUS_M} m.`)
    .max(PKL_MAX_RADIUS_M, `Radius maksimal ${PKL_MAX_RADIUS_M} m.`),
  workHours: WorkHours,
});

/** POST /api/v1/pkl/partners: radius defaults to 150 m. */
export const CreateDudiPartnerRequest = PartnerFields.extend({ radiusM: PartnerFields.shape.radiusM.default(PKL_DEFAULT_RADIUS_M) })
  .strict()
  .meta({ id: 'CreateDudiPartnerRequest' });
export type CreateDudiPartnerRequest = z.infer<typeof CreateDudiPartnerRequest>;

/** PATCH /api/v1/pkl/partners/{partnerId}: fields left out stay; workHours is replaced as a whole. */
export const UpdateDudiPartnerRequest = PartnerFields.extend({ active: z.boolean() }).partial().strict().meta({ id: 'UpdateDudiPartnerRequest' });
export type UpdateDudiPartnerRequest = z.infer<typeof UpdateDudiPartnerRequest>;

export const DudiPartnerIdParam = z.object({ partnerId: z.uuid() });

/** GET /api/v1/pkl/students?q=: active students of this year by name or NISN, at most 20 (managers). */
export const PklStudentQuery = z.object({ q: z.string().trim().min(2, 'Ketik minimal 2 huruf.').max(60) });

export const PklStudent = z
  .object({ studentId: z.uuid(), enrollmentId: z.uuid(), name: z.string(), nisn: z.string().nullable(), className: z.string() })
  .meta({ id: 'PklStudent' });
export const PklStudentList = z.object({ items: z.array(PklStudent) }).meta({ id: 'PklStudentList' });
export type PklStudentList = z.infer<typeof PklStudentList>;

/** GET /api/v1/pkl/school-mentors: active staff who can be guru pembimbing (managers). */
export const PklStaffList = z.object({ items: z.array(z.object({ id: z.uuid(), name: z.string() })) }).meta({ id: 'PklStaffList' });
export type PklStaffList = z.infer<typeof PklStaffList>;
