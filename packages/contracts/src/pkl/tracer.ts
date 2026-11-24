import { z } from 'zod';
import { ClassStream } from '../academic/enums';
import { PhoneNumberId } from '../platform/invitations';

/**
 * Tracer study (PKL-05): where graduates are one or more years later. Status BMW = bekerja, melanjutkan, wirausaha; "belum" is a
 * graduate who answered and is none of them (yet). The BKK (here: humas PKL, wakasek, admin) keeps the alumni list and may enter
 * an answer by hand; alumni answer through a WhatsApp link (prompt 6.2f). Capability pkl.tracer.
 */

export const TRACER_STATUSES = ['bekerja', 'melanjutkan', 'wirausaha', 'belum'] as const;
export const TracerStatus = z.enum(TRACER_STATUSES).meta({ id: 'TracerStatus' });
export type TracerStatus = z.infer<typeof TracerStatus>;
/** The three that count as BMW. */
export const TRACER_BMW = ['bekerja', 'melanjutkan', 'wirausaha'] as const satisfies readonly TracerStatus[];

export const TRACER_SOURCES = ['alumni', 'bkk'] as const;
export const TracerSource = z.enum(TRACER_SOURCES).meta({ id: 'TracerSource' });
export type TracerSource = z.infer<typeof TracerSource>;

export const TRACER_MIN_YEAR = 1990;
export const TRACER_MAX_YEAR = 2100;
const GraduationYear = z.int().min(TRACER_MIN_YEAR).max(TRACER_MAX_YEAR);

export const TracerResponse = z
  .object({
    status: TracerStatus,
    /** Company, campus or business name; null for "belum". */
    organization: z.string().nullable(),
    /** Job title, study programme or line of business. */
    position: z.string().nullable(),
    source: TracerSource,
    answeredAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'TracerResponse' });
export type TracerResponse = z.infer<typeof TracerResponse>;

export const TracerAlumnus = z
  .object({
    id: z.uuid(),
    name: z.string(),
    nisn: z.string().nullable(),
    /** Angkatan: the year they graduated. */
    graduationYear: z.int(),
    stream: ClassStream.nullable(),
    /** Masked WhatsApp number; null without one. */
    phone: z.string().nullable(),
    response: TracerResponse.nullable(),
  })
  .meta({ id: 'TracerAlumnus' });
export type TracerAlumnus = z.infer<typeof TracerAlumnus>;

export const TracerAlumniList = z.object({ items: z.array(TracerAlumnus) }).meta({ id: 'TracerAlumniList' });
export type TracerAlumniList = z.infer<typeof TracerAlumniList>;

export const TracerAlumniQuery = z
  .object({
    graduationYear: z.coerce.number().int().min(TRACER_MIN_YEAR).max(TRACER_MAX_YEAR).optional(),
    stream: ClassStream.optional(),
    answered: z.enum(['yes', 'no']).optional(),
    q: z.string().trim().min(2).max(60).optional(),
  })
  .meta({ id: 'TracerAlumniQuery' });
export type TracerAlumniQuery = z.infer<typeof TracerAlumniQuery>;

export const CreateTracerAlumnusRequest = z
  .object({
    name: z.string().trim().min(2, 'Tulis nama alumni.').max(100),
    nisn: z.string().regex(/^\d{10}$/, 'NISN terdiri dari 10 angka.').nullish(),
    graduationYear: GraduationYear,
    stream: ClassStream.nullish(),
    phoneNumber: PhoneNumberId.nullish(),
  })
  .strict()
  .meta({ id: 'CreateTracerAlumnusRequest' });
export type CreateTracerAlumnusRequest = z.infer<typeof CreateTracerAlumnusRequest>;

/** Copies the active students of a rombel into the alumni list (their jurusan comes from the rombel); students already there are skipped. */
export const AlumniFromClassRequest = z.object({ classId: z.uuid(), graduationYear: GraduationYear }).strict().meta({ id: 'AlumniFromClassRequest' });
export type AlumniFromClassRequest = z.infer<typeof AlumniFromClassRequest>;

export const AlumniFromClassResult = z.object({ added: z.int().nonnegative(), skipped: z.int().nonnegative() }).meta({ id: 'AlumniFromClassResult' });
export type AlumniFromClassResult = z.infer<typeof AlumniFromClassResult>;

/** PUT /api/v1/tracer/alumni/{alumnusId}/response: entered by the BKK (source bkk); giving it again replaces it. */
export const SaveTracerResponseRequest = z
  .object({
    status: TracerStatus,
    organization: z.string().trim().max(120).nullish(),
    position: z.string().trim().max(120).nullish(),
  })
  .strict()
  .refine((r) => r.status === 'belum' || Boolean(r.organization), { message: 'Tulis nama perusahaan, kampus, atau usahanya.', path: ['organization'] })
  .meta({ id: 'SaveTracerResponseRequest' });
export type SaveTracerResponseRequest = z.infer<typeof SaveTracerResponseRequest>;

export const TracerAlumnusIdParam = z.object({ alumnusId: z.uuid() });

const Counts = z.object({ bekerja: z.int(), melanjutkan: z.int(), wirausaha: z.int(), belum: z.int() });
export type TracerCounts = z.infer<typeof Counts>;

/** One angkatan and jurusan. bmwPercent = BMW of those who answered, one decimal; null before anyone answered. */
export const TracerRecapRow = z
  .object({
    graduationYear: z.int(),
    stream: ClassStream.nullable(),
    total: z.int(),
    answered: z.int(),
    counts: Counts,
    bmwPercent: z.number().min(0).max(100).nullable(),
  })
  .meta({ id: 'TracerRecapRow' });
export type TracerRecapRow = z.infer<typeof TracerRecapRow>;

/** GET /api/v1/tracer/recap: per angkatan (newest first) and jurusan, plus the totals. */
export const TracerRecap = z
  .object({
    rows: z.array(TracerRecapRow),
    totals: z.object({ total: z.int(), answered: z.int(), counts: Counts, bmwPercent: z.number().min(0).max(100).nullable() }),
  })
  .meta({ id: 'TracerRecap' });
export type TracerRecap = z.infer<typeof TracerRecap>;

/** How long an alumnus may answer (and change the answer) through the WhatsApp link. */
export const TRACER_LINK_DAYS = 30;
/** The web page the link opens; the token follows in the #fragment. */
export const TRACER_LINK_PATH = '/alumni';

/**
 * GET /api/v1/tracer/form (Authorization: Tracer <token>): what the alumni page shows. First name only: a link can be forwarded.
 * `response` is the current answer, so opening the link again shows it and a change replaces it.
 */
export const TracerFormContext = z
  .object({
    schoolName: z.string(),
    firstName: z.string(),
    graduationYear: z.int(),
    response: z.object({ status: TracerStatus, organization: z.string().nullable(), position: z.string().nullable(), answeredAt: z.iso.datetime({ offset: true }) }).nullable(),
    expiresAt: z.iso.datetime({ offset: true }),
  })
  .meta({ id: 'TracerFormContext' });
export type TracerFormContext = z.infer<typeof TracerFormContext>;

/**
 * POST /api/v1/tracer/invitations (BKK): sends the WhatsApp link to the listed alumni or to a whole angkatan. Only alumni with a
 * number are invited, and those who already answered only with `resend`. Sending the same day twice sends nothing twice.
 */
export const InviteTracerRequest = z
  .object({
    alumnusIds: z.array(z.uuid()).min(1).max(500).optional(),
    graduationYear: GraduationYear.optional(),
    resend: z.boolean().default(false),
  })
  .strict()
  .refine((r) => (r.alumnusIds === undefined) !== (r.graduationYear === undefined), { message: 'Pilih alumni atau satu angkatan.', path: ['alumnusIds'] })
  .meta({ id: 'InviteTracerRequest' });
export type InviteTracerRequest = z.infer<typeof InviteTracerRequest>;

export const InviteTracerResult = z.object({ queued: z.int().nonnegative(), withoutPhone: z.int().nonnegative(), alreadyAnswered: z.int().nonnegative() }).meta({ id: 'InviteTracerResult' });
export type InviteTracerResult = z.infer<typeof InviteTracerResult>;

/** The rombel an angkatan can be copied from (PKL-05): the BKK (humas PKL) cannot read the registry's /classes, so the tracer lists them itself. */
export const TracerClassList = z
  .object({ items: z.array(z.object({ id: z.uuid(), name: z.string(), grade: z.int(), stream: ClassStream.nullable(), activeStudents: z.int() })) })
  .meta({ id: 'TracerClassList' });
export type TracerClassList = z.infer<typeof TracerClassList>;
