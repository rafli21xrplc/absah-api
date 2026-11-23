import type { AttendanceStatus, PklCheckin, PklCheckinBody, PklToday } from '@absah/contracts';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError } from '../../../shared/errors';
import { emit } from '../../../shared/outbox';
import type { Actor } from '../../../shared/policy';
import { schoolDate, schoolMinutes } from '../../../shared/school-date';
import { openPklSession } from '../../attendance';
import { classifyCheckin, confirmedStatus, roundCoordinate } from '../domain/checkin-rules';
import { canCheckIn } from '../domain/policies';
import { checkinsOf, insertCheckin, studentPlacementOn, type CheckinRow } from '../infrastructure/checkin-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });

/** The day's status a check-in stands for, once confirmed or decided. */
export function checkinStatus(row: Pick<CheckinRow, 'confirmStatus' | 'late' | 'decidedStatus'>): AttendanceStatus | null {
  if (row.confirmStatus === 'confirmed') return confirmedStatus(row.late);
  if (row.confirmStatus === 'decided') return row.decidedStatus as AttendanceStatus;
  return null;
}

function toCheckin(row: CheckinRow): PklCheckin {
  return {
    id: row.id,
    kind: row.kind,
    schoolDate: row.schoolDate,
    recordedAt: row.recordedAt.toISOString(),
    distanceM: row.distanceM,
    reviewReasons: row.reviewReasons,
    late: row.late,
    confirmStatus: row.confirmStatus,
    status: checkinStatus(row),
  };
}

/**
 * POST /pkl/checkins (PKL-02): the student presses check-in or check-out. The server measures the
 * distance to the DUDI, checks today's working hours and the phone's clock, and stores a point rounded
 * to 4 decimals. One check-in and one check-out per day: a second one answers 409 already_recorded.
 * A check-in makes sure today's PKL session exists; only a confirmation writes the status.
 */
export function recordCheckin(actor: Actor, auditCtx: AuditContext, timezone: string, input: PklCheckinBody, now = new Date()): Promise<PklCheckin> {
  authorize(actor, canCheckIn);
  const today = schoolDate(timezone, now);
  return withTenant(scope(actor), async (tx) => {
    const placement = await studentPlacementOn(tx, actor.userId, today);
    if (!placement) throw new ConflictError('Kamu tidak sedang PKL hari ini.', { reason: 'no_placement' });
    const result = classifyCheckin({
      kind: input.kind,
      point: { latitude: input.latitude, longitude: input.longitude },
      partner: placement.partner,
      hours: placement.hours,
      localMinutes: schoolMinutes(timezone, now),
      deviceTime: new Date(input.deviceTime),
      serverTime: now,
      hasIndustryMentor: placement.industryMentorId !== null,
    });
    const id = await insertCheckin(tx, {
      schoolId: actor.schoolId,
      placementId: placement.placementId,
      schoolDate: today,
      kind: input.kind,
      recordedAt: now,
      deviceTime: new Date(input.deviceTime),
      latitude: roundCoordinate(input.latitude),
      longitude: roundCoordinate(input.longitude),
      accuracyM: input.accuracyM === undefined ? null : Math.round(input.accuracyM),
      distanceM: result.distanceM,
      reviewReasons: result.reasons,
      late: result.late,
      confirmStatus: result.confirmStatus,
    });
    if (!id) {
      const label = input.kind === 'in' ? 'Check-in' : 'Check-out';
      throw new ConflictError(`${label} hari ini sudah tercatat.`, { reason: 'already_recorded' });
    }
    if (input.kind === 'in') await openPklSession(tx, actor.schoolId, placement.placementId, today);
    await emit(tx, 'pkl.checkin_recorded', { checkinId: id });
    await audit(tx, auditCtx, 'pkl.checkin_recorded', { type: 'pkl_checkin', id }, {
      after: { kind: input.kind, distanceM: result.distanceM, reviewReasons: result.reasons, confirmStatus: result.confirmStatus },
    });
    const row = (await checkinsOf(tx, placement.placementId, today)).find((r) => r.id === id);
    if (!row) throw new Error('check-in vanished');
    return toCheckin(row);
  });
}

/** GET /pkl/me: the student's placement today and today's check-in/out (no coordinates). */
export function myPklToday(actor: Actor, timezone: string, now = new Date()): Promise<PklToday> {
  authorize(actor, canCheckIn);
  const today = schoolDate(timezone, now);
  return withTenant(scope(actor), async (tx) => {
    const placement = await studentPlacementOn(tx, actor.userId, today);
    if (!placement) return { date: today, placement: null, checkIn: null, checkOut: null };
    const rows = await checkinsOf(tx, placement.placementId, today);
    const of = (kind: 'in' | 'out') => {
      const row = rows.find((r) => r.kind === kind);
      return row ? toCheckin(row) : null;
    };
    return {
      date: today,
      placement: {
        id: placement.placementId,
        partner: { name: placement.partner.name, address: placement.partner.address, radiusM: placement.partner.radiusM },
        startsOn: placement.startsOn,
        endsOn: placement.endsOn,
        schoolMentor: placement.schoolMentorName,
        industryMentor: placement.industryMentorName,
        hours: placement.hours,
      },
      checkIn: of('in'),
      checkOut: of('out'),
    };
  });
}
