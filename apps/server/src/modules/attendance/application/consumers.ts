import { defineConsumer, type Consumer } from '../../../shared/outbox';
import { syncLeaveMarks } from './leave-marks';
import { syncUksMarks } from './uks-marks';

/** Outbox consumers of the attendance module; the worker registers them. */
export function attendanceConsumers(): Consumer[] {
  return [
    defineConsumer({
      name: 'attendance_apply_leave',
      event: 'leave.approved',
      handle: (tx, event) => syncLeaveMarks(tx, event.schoolId, event.payload.leaveRequestId),
    }),
    defineConsumer({
      name: 'attendance_revoke_leave',
      event: 'leave.cancelled',
      handle: (tx, event) => syncLeaveMarks(tx, event.schoolId, event.payload.leaveRequestId),
    }),
    defineConsumer({
      name: 'attendance_apply_uks_sent_home',
      event: 'uks.sent_home',
      handle: (tx, event) => syncUksMarks(tx, event.schoolId, event.payload.uksVisitId),
    }),
  ];
}
