import type { Tx } from '@absah/db';
import { schoolMinutes } from '../../../shared/school-date';
import { DEFAULT_SCHOOL_START, gateStatusFor, minutesOf } from '../domain/gate-status';
import { isoWeekday } from '../domain/status-rules';
import { arrivalCoverage, firstLessonStart } from '../infrastructure/gate-marks-repo';
import type { MarkWrite } from '../infrastructure/marks-repo';
import { changeMarks } from './marks';

/** "HH:MM" after which a gate arrival is late (T): the first jam pelajaran, else 07.00. */
export async function schoolStartTime(tx: Tx, schoolDate: string): Promise<string> {
  return (await firstLessonStart(tx, isoWeekday(schoolDate)))?.slice(0, 5) ?? DEFAULT_SCHOOL_START;
}

/**
 * Writes gate marks (H/T per session) for accepted arrivals of a date: right after a scan for one
 * student, and after session generation for everyone already in (scans before 05.00, offline sync).
 */
export async function applyGateArrivals(tx: Tx, schoolId: string, timezone: string, filter: { schoolDate: string; enrollmentId?: string }): Promise<number> {
  const start = minutesOf(await schoolStartTime(tx, filter.schoolDate));
  const write = (await arrivalCoverage(tx, filter)).flatMap((row): MarkWrite[] => {
    const status = gateStatusFor(row, schoolMinutes(timezone, row.scannedAt), start);
    return status ? [{ sessionId: row.sessionId, enrollmentId: row.enrollmentId, source: 'gate', status, sourceRef: row.scanId, recordedBy: null }] : [];
  });
  await changeMarks(tx, schoolId, { write });
  return write.length;
}
