// Public API of the attendance module (PRS). Other modules import only from here.
export {
  ATTENDANCE_JOB_CRON,
  attendanceJobHandlers,
  GENERATE_SESSIONS_QUEUE,
  generateDueSessions,
  generateForSchool,
  LOCK_SESSIONS_QUEUE,
  lockDueDays,
  REMIND_UNFILLED_QUEUE,
  remindUnfilled,
} from './jobs/session-jobs';
export { sessionsRouter } from './http/sessions';
export { journalRouter } from './http/journal';
export { correctionsRouter } from './http/corrections';
export { findSchool, markReminded as markSessionsReminded } from './infrastructure/session-repo';
export { schoolDayOf, schoolDaysBetween } from './application/school-day';
export { attendanceConsumers } from './application/consumers';
export { applyGateArrivals, schoolStartTime } from './application/gate-marks';
export { openActivitySession } from './application/activity-sessions';
export { openPklSession, setPklStatus } from './application/pkl-sessions';
export { getSession } from './application/sessions';
export { listSessions, type SessionRow } from './infrastructure/attendance-repo';
export { isoWeekday } from './domain/status-rules';
