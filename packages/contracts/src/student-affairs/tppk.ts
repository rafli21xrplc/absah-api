import { z } from 'zod';

/**
 * TPPK (KSW-06/07, behind student.tppk): reports of violence to the school's Tim Pencegahan dan
 * Penanganan Kekerasan. Only TPPK members read reports and cases (RLS on the tppk schema); not the
 * admin, not the kepsek, not Absah support.
 */

/** Forms of violence named in Permendikbudristek 46/2023, plus "lainnya". */
export const TPPK_REPORT_CATEGORIES = ['fisik', 'psikis', 'perundungan', 'seksual', 'diskriminasi', 'kebijakan', 'lainnya'] as const;
export const TppkReportCategory = z.enum(TPPK_REPORT_CATEGORIES).meta({ id: 'TppkReportCategory' });
export type TppkReportCategory = z.infer<typeof TppkReportCategory>;

/** What the reporter sees with the tracking code, and nothing more. */
export const TPPK_REPORT_STATUSES = ['diterima', 'ditangani', 'selesai'] as const;
export const TppkReportStatus = z.enum(TPPK_REPORT_STATUSES).meta({ id: 'TppkReportStatus' });
export type TppkReportStatus = z.infer<typeof TppkReportStatus>;

export const TPPK_REPORTER_RELATIONS = ['siswa', 'orang_tua', 'guru', 'tenaga_kependidikan', 'lainnya'] as const;
export const TppkReporterRelation = z.enum(TPPK_REPORTER_RELATIONS).meta({ id: 'TppkReporterRelation' });
export type TppkReporterRelation = z.infer<typeof TppkReporterRelation>;

export const TPPK_CASE_STATUSES = ['open', 'closed'] as const;
export const TppkCaseStatus = z.enum(TPPK_CASE_STATUSES).meta({ id: 'TppkCaseStatus' });
export type TppkCaseStatus = z.infer<typeof TppkCaseStatus>;

export const TPPK_EVENT_KINDS = ['catatan', 'langkah', 'ditutup', 'dibuka_kembali'] as const;
export const TppkEventKind = z.enum(TPPK_EVENT_KINDS).meta({ id: 'TppkEventKind' });
export type TppkEventKind = z.infer<typeof TppkEventKind>;

/** The team should have at least this many members; fewer is allowed but warned about. */
export const TPPK_MIN_MEMBERS = 3;

export const TppkMember = z
  .object({ userId: z.uuid(), name: z.string(), appointedAt: z.iso.datetime({ offset: true }) })
  .meta({ id: 'TppkMember' });
export type TppkMember = z.infer<typeof TppkMember>;

/** GET|PUT /api/v1/tppk/members. belowMinimum is the warning the admin sees. */
export const TppkMemberList = z
  .object({ items: z.array(TppkMember), minimum: z.number().int(), belowMinimum: z.boolean() })
  .meta({ id: 'TppkMemberList' });
export type TppkMemberList = z.infer<typeof TppkMemberList>;

/** PUT /api/v1/tppk/members (admin): the whole team; members not listed are removed. */
export const SetTppkMembersRequest = z
  .object({
    userIds: z
      .array(z.uuid())
      .max(30)
      .refine((ids) => new Set(ids).size === ids.length, 'Anggota tidak boleh ganda.'),
  })
  .strict()
  .meta({ id: 'SetTppkMembersRequest' });
export type SetTppkMembersRequest = z.infer<typeof SetTppkMembersRequest>;

/** Crockford base32: no I, L, O, U, so a code read aloud or copied by hand survives. 32^10 = 2^50. */
export const TRACKING_CODE_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export const TRACKING_CODE_LENGTH = 10;

/** Upper case, spaces and dashes dropped, O/I/L read as 0/1/1 (as Crockford does). */
export function normalizeTrackingCode(raw: string): string {
  return raw
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/O/g, '0')
    .replace(/[IL]/g, '1');
}
export const TppkTrackingCode = z
  .string()
  .max(40)
  .transform(normalizeTrackingCode)
  .pipe(z.string().regex(/^[0-9A-HJKMNP-TV-Z]{10}$/));

/** GET /api/v1/tppk/channel/{schoolId} (public): the form shows the school; 404 when closed or unknown. */
export const TppkChannel = z.object({ schoolName: z.string() }).meta({ id: 'TppkChannel' });
export type TppkChannel = z.infer<typeof TppkChannel>;

/**
 * POST /api/v1/tppk/reports (public, rate limited). Anonymous: no name, no contact, and the server
 * keeps nothing that points to the reporter (not the account, not the IP).
 */
export const CreateTppkReportRequest = z
  .object({
    schoolId: z.uuid(),
    category: TppkReportCategory,
    chronology: z.string().trim().min(20, 'Ceritakan apa yang terjadi, minimal 20 huruf.').max(5000),
    occurredOn: z.iso.date().optional(),
    reporterRelation: TppkReporterRelation,
    anonymous: z.boolean(),
    reporterName: z.string().trim().min(2).max(100).optional(),
    reporterContact: z.string().trim().min(5).max(100).optional(),
  })
  .strict()
  .refine((v) => !v.anonymous || (v.reporterName === undefined && v.reporterContact === undefined), {
    message: 'Laporan anonim tidak menyimpan nama atau kontak.',
    path: ['anonymous'],
  })
  .meta({ id: 'CreateTppkReportRequest' });
export type CreateTppkReportRequest = z.infer<typeof CreateTppkReportRequest>;

/** Shown once: the server keeps only a keyed hash of the code. */
export const TppkReportReceipt = z
  .object({ trackingCode: z.string().length(TRACKING_CODE_LENGTH), status: TppkReportStatus })
  .meta({ id: 'TppkReportReceipt' });
export type TppkReportReceipt = z.infer<typeof TppkReportReceipt>;

/** GET /api/v1/tppk/reports/track/{code}: the status and nothing else. */
export const TppkTrackResponse = z.object({ status: TppkReportStatus }).meta({ id: 'TppkTrackResponse' });
export type TppkTrackResponse = z.infer<typeof TppkTrackResponse>;

export const TppkSchoolParam = z.object({ schoolId: z.uuid() });
export const TppkCodeParam = z.object({ code: z.string().max(40) });

// --- Members only (KSW-07): reports and cases. Every read and write is audited. ---

const Person = z.object({ id: z.uuid(), name: z.string() });

export const TppkReportSummary = z
  .object({
    id: z.uuid(),
    category: TppkReportCategory,
    status: TppkReportStatus,
    receivedAt: z.iso.datetime({ offset: true }),
    occurredOn: z.iso.date().nullable(),
    reporterRelation: TppkReporterRelation,
    isAnonymous: z.boolean(),
    caseId: z.uuid().nullable(),
  })
  .meta({ id: 'TppkReportSummary' });
export type TppkReportSummary = z.infer<typeof TppkReportSummary>;

export const TppkReportDetail = TppkReportSummary.extend({
  chronology: z.string(),
  /** Null when anonymous. account: the signed-in user who filed it under their name. */
  reporter: z.object({ name: z.string().nullable(), contact: z.string().nullable(), account: Person.nullable() }).nullable(),
}).meta({ id: 'TppkReportDetail' });
export type TppkReportDetail = z.infer<typeof TppkReportDetail>;

/** GET /api/v1/tppk/reports?status=: newest first. */
export const TppkReportsQuery = z.object({ status: TppkReportStatus.optional() }).meta({ id: 'TppkReportsQuery' });
export const TppkReportList = z.object({ items: z.array(TppkReportSummary) }).meta({ id: 'TppkReportList' });
export type TppkReportList = z.infer<typeof TppkReportList>;
export const TppkReportIdParam = z.object({ reportId: z.uuid() });

export const TppkCaseEvent = z
  .object({ id: z.uuid(), kind: TppkEventKind, note: z.string(), createdAt: z.iso.datetime({ offset: true }), createdBy: Person.nullable() })
  .meta({ id: 'TppkCaseEvent' });
export type TppkCaseEvent = z.infer<typeof TppkCaseEvent>;

export const TppkCaseSummary = z
  .object({
    id: z.uuid(),
    reportId: z.uuid().nullable(),
    category: TppkReportCategory.nullable(),
    summary: z.string(),
    status: TppkCaseStatus,
    openedAt: z.iso.datetime({ offset: true }),
    openedBy: Person.nullable(),
    closedAt: z.iso.datetime({ offset: true }).nullable(),
  })
  .meta({ id: 'TppkCaseSummary' });
export type TppkCaseSummary = z.infer<typeof TppkCaseSummary>;

export const TppkCaseDetail = TppkCaseSummary.extend({ report: TppkReportDetail.nullable(), events: z.array(TppkCaseEvent) }).meta({ id: 'TppkCaseDetail' });
export type TppkCaseDetail = z.infer<typeof TppkCaseDetail>;

/** GET /api/v1/tppk/cases?status=: open first by default order of opening, newest first. */
export const TppkCasesQuery = z.object({ status: TppkCaseStatus.optional() }).meta({ id: 'TppkCasesQuery' });
export const TppkCaseList = z.object({ items: z.array(TppkCaseSummary) }).meta({ id: 'TppkCaseList' });
export type TppkCaseList = z.infer<typeof TppkCaseList>;
export const TppkCaseIdParam = z.object({ caseId: z.uuid() });

/** POST /api/v1/tppk/cases: from a report (it becomes "ditangani"), or without one (seen directly). */
export const CreateTppkCaseRequest = z
  .object({ reportId: z.uuid().optional(), summary: z.string().trim().min(5, 'Tulis ringkasan kasus.').max(300) })
  .strict()
  .meta({ id: 'CreateTppkCaseRequest' });
export type CreateTppkCaseRequest = z.infer<typeof CreateTppkCaseRequest>;

const Note = z.string().trim().min(2, 'Tulis catatannya.').max(4000);

/** POST /api/v1/tppk/cases/{caseId}/events: a note or a step taken. Open cases only. */
export const AddTppkCaseEventRequest = z
  .object({ kind: z.enum(['catatan', 'langkah']), note: Note })
  .strict()
  .meta({ id: 'AddTppkCaseEventRequest' });
export type AddTppkCaseEventRequest = z.infer<typeof AddTppkCaseEventRequest>;

/** POST /api/v1/tppk/cases/{caseId}/close and /reopen: why, kept as an event. */
export const TppkCaseNoteRequest = z.object({ note: Note }).strict().meta({ id: 'TppkCaseNoteRequest' });
export type TppkCaseNoteRequest = z.infer<typeof TppkCaseNoteRequest>;
