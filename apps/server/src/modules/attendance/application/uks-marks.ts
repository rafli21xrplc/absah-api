import type { Tx } from '@absah/db';
import { findSchool } from '../infrastructure/session-repo';
import type { MarkWrite } from '../infrastructure/marks-repo';
import { sentHomeCoverage } from '../infrastructure/uks-marks-repo';
import { changeMarks } from './marks';

type Coverage = Awaited<ReturnType<typeof sentHomeCoverage>>;

const toMarks = (rows: Coverage): MarkWrite[] =>
  rows.map((r) => ({
    sessionId: r.sessionId,
    enrollmentId: r.enrollmentId,
    source: 'uks',
    status: 'S',
    sourceRef: r.uksVisitId,
    recordedBy: r.recordedBy,
  }));

async function timezoneOf(tx: Tx, schoolId: string): Promise<string> {
  const school = await findSchool(tx, schoolId);
  if (!school) throw new Error('school not found');
  return school.timezone;
}

/**
 * KSW-08: a student sent home from UKS is sakit (source uks) for the rest of the day. Re-reads the
 * visit, so a redelivered event writes the same marks. UKS outranks the teacher and the gate but
 * not izin or a correction (SOURCE_PRIORITY).
 */
export async function syncUksMarks(tx: Tx, schoolId: string, uksVisitId: string): Promise<void> {
  const write = toMarks(await sentHomeCoverage(tx, await timezoneOf(tx, schoolId), { uksVisitId }));
  await changeMarks(tx, schoolId, { removeRef: { source: 'uks', sourceRef: uksVisitId }, write });
}

/** Sessions created later the same day (a forced regeneration) get the visits already recorded. */
export async function applyUksToDate(tx: Tx, schoolId: string, schoolDate: string): Promise<number> {
  const write = toMarks(await sentHomeCoverage(tx, await timezoneOf(tx, schoolId), { schoolDate }));
  await changeMarks(tx, schoolId, { write });
  return write.length;
}
