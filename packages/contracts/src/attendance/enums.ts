import { z } from 'zod';

/** daily: one session per rombel per day (SD/MI); per_period: one per lesson; activity and pkl later. */
export const SESSION_MODES = ['per_period', 'daily', 'activity', 'pkl'] as const;
export const SessionMode = z.enum(SESSION_MODES).meta({ id: 'SessionMode' });
export type SessionMode = z.infer<typeof SessionMode>;

/** open until filled; submitted can be refilled until the 23.59 lock; missed = never filled; locked = closed. */
export const SESSION_STATUSES = ['open', 'submitted', 'missed', 'locked'] as const;
export const SessionStatus = z.enum(SESSION_STATUSES).meta({ id: 'SessionStatus' });
export type SessionStatus = z.infer<typeof SessionStatus>;

/** H hadir, S sakit, I izin, A alpa, T terlambat. */
export const ATTENDANCE_STATUSES = ['H', 'S', 'I', 'A', 'T'] as const;
export const AttendanceStatus = z.enum(ATTENDANCE_STATUSES).meta({ id: 'AttendanceStatus' });
export type AttendanceStatus = z.infer<typeof AttendanceStatus>;

/** Where a status came from. Priority (high to low): manual, leave, uks, pkl_confirm, teacher, gate. */
export const ATTENDANCE_SOURCES = ['teacher', 'gate', 'leave', 'uks', 'pkl_confirm', 'manual'] as const;
export const AttendanceSource = z.enum(ATTENDANCE_SOURCES).meta({ id: 'AttendanceSource' });
export type AttendanceSource = z.infer<typeof AttendanceSource>;

export const CORRECTION_STATUSES = ['pending', 'approved', 'rejected'] as const;
export const CorrectionStatus = z.enum(CORRECTION_STATUSES).meta({ id: 'CorrectionStatus' });
export type CorrectionStatus = z.infer<typeof CorrectionStatus>;

/** Who a session belongs to: a rombel, a learning group, an activity (KEG) or a PKL placement. */
export const SESSION_OWNER_TYPES = ['class', 'group', 'activity', 'placement'] as const;
export const SessionOwnerType = z.enum(SESSION_OWNER_TYPES).meta({ id: 'SessionOwnerType' });
export type SessionOwnerType = z.infer<typeof SessionOwnerType>;
