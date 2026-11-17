import type { Tx } from '@absah/db';
import { SessionLockedError } from '../../../shared/errors';
import { activitySession } from '../domain/session-plan';
import { activitySessionOf, ensureDay, findDay, insertSessions, lockAttendanceDay } from '../infrastructure/session-repo';
import { applyLeavesToDate } from './leave-marks';
import { applyUksToDate } from './uks-marks';

/**
 * Opens the activity session of a date, or returns the one already there (KEG-01): the same
 * session engine as lessons, so locking, corrections and izin work unchanged. The caller (the
 * activity module) has checked who may open it. Refused once the day is locked.
 */
export async function openActivitySession(tx: Tx, schoolId: string, activityId: string, date: string): Promise<string> {
  await lockAttendanceDay(tx, schoolId, date);
  if ((await findDay(tx, date))?.lockedAt) throw new SessionLockedError();
  await ensureDay(tx, schoolId, date);
  await insertSessions(tx, schoolId, date, [activitySession(activityId)]);
  await applyLeavesToDate(tx, schoolId, date);
  await applyUksToDate(tx, schoolId, date);
  const id = await activitySessionOf(tx, activityId, date);
  if (!id) throw new Error('activity session vanished');
  return id;
}
