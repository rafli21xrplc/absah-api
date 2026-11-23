import { z } from 'zod';
import { SchoolDay } from '../academic/enums';

/** Kegiatan (KEG-01): ekskul, upacara, ibadah. Attendance runs on the one session engine (mode activity). */

export const ACTIVITY_KINDS = ['ekskul', 'upacara', 'ibadah', 'lainnya'] as const;
export const ActivityKind = z.enum(ACTIVITY_KINDS).meta({ id: 'ActivityKind' });
export type ActivityKind = z.infer<typeof ActivityKind>;

/** Off-campus activities lower the MBG forecast for their dates (RKP-09). */
export const ACTIVITY_LOCATIONS = ['sekolah', 'luar_sekolah'] as const;
export const ActivityLocation = z.enum(ACTIVITY_LOCATIONS).meta({ id: 'ActivityLocation' });
export type ActivityLocation = z.infer<typeof ActivityLocation>;

const Person = z.object({ id: z.uuid(), name: z.string() });

export const Activity = z
  .object({
    id: z.uuid(),
    name: z.string(),
    kind: ActivityKind,
    location: ActivityLocation,
    /** Weekdays it meets (1 = Senin); empty = only on the dates a coach opens a session. */
    days: z.array(SchoolDay),
    startsOn: z.iso.date().nullable(),
    endsOn: z.iso.date().nullable(),
    active: z.boolean(),
    coaches: z.array(Person),
    memberCount: z.number().int(),
  })
  .meta({ id: 'Activity' });
export type Activity = z.infer<typeof Activity>;

export const ActivityList = z.object({ items: z.array(Activity) }).meta({ id: 'ActivityList' });
export type ActivityList = z.infer<typeof ActivityList>;

const Days = z
  .array(SchoolDay)
  .max(7)
  .refine((d) => new Set(d).size === d.length, 'Hari tidak boleh ganda.');
const Coaches = z
  .array(z.uuid())
  .min(1, 'Pilih minimal satu pembina.')
  .max(10)
  .refine((ids) => new Set(ids).size === ids.length, 'Pembina tidak boleh ganda.');

const ActivityFields = z.object({
  name: z.string().trim().min(2, 'Tulis nama kegiatan.').max(100),
  kind: ActivityKind,
  location: ActivityLocation,
  days: Days,
  startsOn: z.iso.date().nullable(),
  endsOn: z.iso.date().nullable(),
  coachIds: Coaches,
});
const datesInOrder = (v: { startsOn?: string | null; endsOn?: string | null }) => !v.startsOn || !v.endsOn || v.startsOn <= v.endsOn;

/** POST /api/v1/activities (admin, wakasek): in the active academic year. */
export const CreateActivityRequest = ActivityFields.extend({ startsOn: ActivityFields.shape.startsOn.optional(), endsOn: ActivityFields.shape.endsOn.optional() })
  .strict()
  .refine(datesInOrder, { message: 'Tanggal selesai tidak boleh sebelum tanggal mulai.', path: ['endsOn'] })
  .meta({ id: 'CreateActivityRequest' });
export type CreateActivityRequest = z.infer<typeof CreateActivityRequest>;

/** PATCH /api/v1/activities/{activityId} (admin, wakasek): fields left out stay. */
export const UpdateActivityRequest = ActivityFields.extend({ active: z.boolean() })
  .partial()
  .strict()
  .refine(datesInOrder, { message: 'Tanggal selesai tidak boleh sebelum tanggal mulai.', path: ['endsOn'] })
  .meta({ id: 'UpdateActivityRequest' });
export type UpdateActivityRequest = z.infer<typeof UpdateActivityRequest>;

export const ActivityIdParam = z.object({ activityId: z.uuid() });

export const ActivityMember = z.object({ enrollmentId: z.uuid(), name: z.string(), className: z.string() }).meta({ id: 'ActivityMember' });
export type ActivityMember = z.infer<typeof ActivityMember>;
export const ActivityMemberList = z.object({ items: z.array(ActivityMember) }).meta({ id: 'ActivityMemberList' });
export type ActivityMemberList = z.infer<typeof ActivityMemberList>;

/** PUT /api/v1/activities/{activityId}/members (managers, the activity's coaches): the whole list. */
export const SetActivityMembersRequest = z
  .object({ enrollmentIds: z.array(z.uuid()).max(1000) })
  .strict()
  .meta({ id: 'SetActivityMembersRequest' });
export type SetActivityMembersRequest = z.infer<typeof SetActivityMembersRequest>;

/** GET /api/v1/activities/students?q=: active students of this year by name, at most 20, to add. */
export const ActivityStudentQuery = z.object({ q: z.string().trim().min(2, 'Ketik minimal 2 huruf.').max(60) });

/** POST /api/v1/activities/{activityId}/sessions: the session of a date (default today); returns it to fill. */
export const OpenActivitySessionRequest = z.object({ date: z.iso.date().optional() }).strict().meta({ id: 'OpenActivitySessionRequest' });
export type OpenActivitySessionRequest = z.infer<typeof OpenActivitySessionRequest>;

/** GET /api/v1/activities/{activityId}/recap?from&to: separate from the rombel S/I/A rekap. */
export const ActivityRecapQuery = z
  .object({ from: z.iso.date(), to: z.iso.date() })
  .refine((v) => v.from <= v.to, { message: 'Tanggal akhir tidak boleh sebelum tanggal awal.', path: ['to'] })
  .refine((v) => (Date.parse(v.to) - Date.parse(v.from)) / 86_400_000 <= 366, { message: 'Rentang paling lama satu tahun.', path: ['to'] });

const Counts = z.object({ H: z.number().int(), T: z.number().int(), S: z.number().int(), I: z.number().int(), A: z.number().int() });

export const ActivityRecap = z
  .object({
    from: z.iso.date(),
    to: z.iso.date(),
    /** Activity sessions in the range (filled or not). */
    sessions: z.number().int(),
    items: z.array(ActivityMember.extend({ counts: Counts, presentRate: z.number().nullable() })),
  })
  .meta({ id: 'ActivityRecap' });
export type ActivityRecap = z.infer<typeof ActivityRecap>;
