import type { AttendanceStatus } from '@absah/contracts';
import { schema, type Tx } from '@absah/db';
import { and, eq } from 'drizzle-orm';
import { ensureDay, findDay, lockAttendanceDay } from '../infrastructure/session-repo';
import { applyLeavesToDate } from './leave-marks';
import { changeMarks } from './marks';

/**
 * The PKL session of a placement on a date (PKL-02), created when the generate job has not made it
 * yet (placement added after 05.00, or a decision on an older day). On a locked day it is created
 * locked: PKL statuses still arrive later (auto-confirm after 24 h, the guru pembimbing's review).
 * The caller (the pkl module) has checked the placement covers the date.
 */
export async function openPklSession(tx: Tx, schoolId: string, placementId: string, date: string): Promise<string> {
  const s = schema.attendanceSessions;
  const existing = async () => (await tx.select({ id: s.id }).from(s).where(and(eq(s.pklPlacementId, placementId), eq(s.schoolDate, date), eq(s.mode, 'pkl'))))[0]?.id;
  const found = await existing();
  if (found) return found;
  await lockAttendanceDay(tx, schoolId, date);
  await ensureDay(tx, schoolId, date);
  const lockedAt = (await findDay(tx, date))?.lockedAt ?? null;
  await tx
    .insert(s)
    .values({ schoolId, schoolDate: date, mode: 'pkl', ownerType: 'placement', ownerId: placementId, pklPlacementId: placementId, ...(lockedAt ? { status: 'locked', lockedAt } : {}) })
    .onConflictDoNothing();
  await applyLeavesToDate(tx, schoolId, date);
  const id = await existing();
  if (!id) throw new Error('pkl session vanished');
  return id;
}

/**
 * Writes the PKL decision of one day (source pkl_confirm; sourceRef = the check-in, or null for a
 * day decided without one). Izin, UKS and corrections still outrank it.
 */
export function setPklStatus(
  tx: Tx,
  schoolId: string,
  mark: { sessionId: string; enrollmentId: string; status: AttendanceStatus; sourceRef: string | null; recordedBy: string | null },
) {
  return changeMarks(tx, schoolId, { write: [{ ...mark, source: 'pkl_confirm' }] });
}
