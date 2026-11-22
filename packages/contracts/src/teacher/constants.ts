/**
 * Guru (GRU, behind teacher.attendance). Teacher attendance (GRU-01) comes from the staff app today and from a
 * teacher card at the kiosk later; izin guru (GRU-02) is decided by the wakasek; a session whose teacher is away
 * is given to a substitute (GRU-03).
 */
export const TEACHER_ATTENDANCE_SOURCES = ['app', 'kiosk'] as const;
export type TeacherAttendanceSource = (typeof TEACHER_ATTENDANCE_SOURCES)[number];

/** dinas = away on school business: the lessons still need someone, like sick leave. */
export const TEACHER_LEAVE_KINDS = ['sakit', 'izin', 'dinas'] as const;
export type TeacherLeaveKind = (typeof TEACHER_LEAVE_KINDS)[number];
