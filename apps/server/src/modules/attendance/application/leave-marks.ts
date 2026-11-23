import type { Tx } from '@absah/db';
import { approvedLeaveCoverage } from '../infrastructure/leave-marks-repo';
import type { MarkWrite } from '../infrastructure/marks-repo';
import { changeMarks } from './marks';

type Coverage = Awaited<ReturnType<typeof approvedLeaveCoverage>>;

const toMarks = (rows: Coverage): MarkWrite[] =>
  rows.map((r) => ({
    sessionId: r.sessionId,
    enrollmentId: r.enrollmentId,
    source: 'leave',
    status: r.kind === 'sakit' ? 'S' : 'I',
    sourceRef: r.leaveRequestId,
    recordedBy: null,
  }));

/**
 * Brings the marks of one izin in line with its current state: approved -> S/I in every covered
 * session, otherwise none (the next source shows again). Reads the state instead of trusting the
 * event, so approved/cancelled deliveries in any order or repeated end in the same place.
 */
export async function syncLeaveMarks(tx: Tx, schoolId: string, leaveRequestId: string): Promise<void> {
  const write = toMarks(await approvedLeaveCoverage(tx, { leaveRequestId }));
  await changeMarks(tx, schoolId, { removeRef: { source: 'leave', sourceRef: leaveRequestId }, write });
}

/** Sessions just created for a date get the izin approved before they existed. */
export async function applyLeavesToDate(tx: Tx, schoolId: string, schoolDate: string): Promise<number> {
  const write = toMarks(await approvedLeaveCoverage(tx, { schoolDate }));
  await changeMarks(tx, schoolId, { write });
  return write.length;
}
