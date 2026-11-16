import type { Tx } from '@absah/db';
import { emit } from '../../../shared/outbox';
import { removeMarksByRef, resolveRecords, sessionDates, writeMarks, type MarkWrite, type RecordChange } from '../infrastructure/marks-repo';
import { recomputeDaily } from '../infrastructure/session-repo';

/**
 * The one way attendance statuses change: write or remove source marks, re-resolve the records,
 * recompute daily_attendance for the touched days, and emit attendance.absent_marked for students
 * who became A. Returns the record changes.
 */
export async function changeMarks(
  tx: Tx,
  schoolId: string,
  input: { write?: MarkWrite[]; removeRef?: { source: MarkWrite['source']; sourceRef: string }; touch?: { sessionId: string; enrollmentId: string }[] },
): Promise<RecordChange[]> {
  const pairs = [...(input.write ?? []), ...(input.touch ?? [])].map(({ sessionId, enrollmentId }) => ({ sessionId, enrollmentId }));
  // Remove first: a re-sync of one reference removes its old marks and writes the current ones.
  if (input.removeRef) pairs.push(...(await removeMarksByRef(tx, input.removeRef.source, input.removeRef.sourceRef)));
  if (input.write) await writeMarks(tx, schoolId, input.write);
  const changes = await resolveRecords(tx, schoolId, pairs);

  const dates = await sessionDates(tx, [...new Set(pairs.map((p) => p.sessionId))]);
  const byDate = new Map<string, Set<string>>();
  for (const p of pairs) {
    const date = dates.get(p.sessionId);
    if (date) byDate.set(date, (byDate.get(date) ?? new Set()).add(p.enrollmentId));
  }
  for (const [date, enrollments] of byDate) await recomputeDaily(tx, schoolId, date, [...enrollments]);
  for (const c of changes) {
    if (c.after === 'A') await emit(tx, 'attendance.absent_marked', { sessionId: c.sessionId, enrollmentId: c.enrollmentId });
  }
  return changes;
}
