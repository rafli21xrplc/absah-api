import { z } from 'zod';
import { LinkHeldPickup } from '../gate/pickup';
import { AttendanceStatus, SessionMode } from '../attendance/enums';
import { LeaveKind, LeaveStatus } from '../leave/leave-requests';

/** Tautan aksi (ORT-01): days a link in a WhatsApp message keeps working. */
export const ACTION_LINK_DAYS = 7;

/** Web page a link opens: `${appUrl}${ACTION_LINK_PATH}#<token>` (fragment: never sent to a server). */
export const ACTION_LINK_PATH = '/t';

/** GET /api/v1/links/context (header `Authorization: Link <token>`): what the link may show. */
export const ActionLinkContext = z
  .object({
    school: z.object({ name: z.string(), timezone: z.string() }),
    /** First name only: the link may be forwarded. */
    student: z.object({ firstName: z.string(), className: z.string() }),
    expiresAt: z.iso.datetime(),
    today: z.object({
      date: z.iso.date(),
      /** The day's rekap status once computed, else null. */
      status: AttendanceStatus.nullable(),
      sessions: z.array(z.object({ mode: SessionMode, status: AttendanceStatus.nullable() })),
      arrivedAt: z.iso.datetime().nullable(),
    }),
    /** Izin of the last week and ahead, newest first. */
    leaves: z.array(z.object({ id: z.uuid(), kind: LeaveKind, startsOn: z.iso.date(), endsOn: z.iso.date(), status: LeaveStatus })),
    /** False once the link's one write (an izin request) is used, or the student has left. */
    canRequestLeave: z.boolean(),
    /** The school uses the gate, so the link can show the student's card. */
    cardAvailable: z.boolean(),
    /** Unlisted penjemput the kiosk holds today, waiting for this parent (GRB-10), plus today's decided ones. */
    pickups: z.array(LinkHeldPickup),
  })
  .meta({ id: 'ActionLinkContext' });
export type ActionLinkContext = z.infer<typeof ActionLinkContext>;

/** POST /api/v1/links/leave: the link's one write. Goes to the wali kelas as pending. */
export const ActionLinkLeaveRequest = z
  .object({
    kind: LeaveKind,
    startsOn: z.iso.date(),
    endsOn: z.iso.date(),
    reason: z.string().trim().min(3, 'Tulis alasan izin.').max(500),
  })
  .strict()
  .meta({ id: 'ActionLinkLeaveRequest' });
export type ActionLinkLeaveRequest = z.infer<typeof ActionLinkLeaveRequest>;

export const ActionLinkLeave = z
  .object({ id: z.uuid(), kind: LeaveKind, startsOn: z.iso.date(), endsOn: z.iso.date(), status: LeaveStatus })
  .meta({ id: 'ActionLinkLeave' });
export type ActionLinkLeave = z.infer<typeof ActionLinkLeave>;

/**
 * POST /api/v1/links/card: the student's card on this phone. The first call binds a device for the
 * link; later calls return fresh keys for it. When the card is active on another phone the call
 * answers 409 (reason bound_elsewhere) unless `replace` is set, which ends that phone's card.
 */
export const ActionLinkCardRequest = z
  .object({ replace: z.boolean().default(false) })
  .strict()
  .meta({ id: 'ActionLinkCardRequest' });
export type ActionLinkCardRequest = z.infer<typeof ActionLinkCardRequest>;

/** Days of history the PWA shows (ORT-02); the parent portal (5.7) goes further back. */
export const PORTAL_HISTORY_DAYS = 30;

/**
 * GET /api/v1/portal/attendance: the caller's own attendance (siswa) or their children's (orang_tua),
 * one entry per student, last PORTAL_HISTORY_DAYS school days with a rekap status, newest first.
 */
export const PortalAttendance = z
  .object({
    items: z.array(
      z.object({
        studentId: z.uuid(),
        name: z.string(),
        className: z.string(),
        today: z.object({ date: z.iso.date(), status: AttendanceStatus.nullable(), arrivedAt: z.iso.datetime().nullable() }),
        days: z.array(z.object({ date: z.iso.date(), status: AttendanceStatus })),
        counts: z.record(AttendanceStatus, z.int().nonnegative()),
      }),
    ),
  })
  .meta({ id: 'PortalAttendance' });
export type PortalAttendance = z.infer<typeof PortalAttendance>;
