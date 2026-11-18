import type { DecidePklDayRequest, PklDayDecision, PklReviewList } from '@absah/contracts';
import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { audit, type AuditContext } from '../../../shared/audit';
import { withPlatform, withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import { emit } from '../../../shared/outbox';
import type { Actor } from '../../../shared/policy';
import { schoolDate, schoolMinutes } from '../../../shared/school-date';
import { markSessionsReminded, setPklStatus } from '../../attendance';
import { missingCheckinDue } from '../domain/checkin-rules';
import { canManagePkl } from '../domain/policies';
import { lockDayCheckin, markDecided, missingCheckins, pklDay, reviewQueue } from '../infrastructure/review-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const notFound = () => new NotFoundError('Hari PKL tidak ditemukan.');

/** GET /pkl/reviews: the guru pembimbing's open queue (their placements); managers see every one. */
export function listReviews(actor: Actor, today: string): Promise<PklReviewList> {
  return withTenant(scope(actor), async (tx) => {
    const rows = await reviewQueue(tx, today, canManagePkl.allows(actor) ? undefined : actor.userId);
    return {
      items: rows.map((r) => ({
        sessionId: r.session_id,
        date: r.school_date,
        placementId: r.placement_id,
        student: { studentId: r.student_id, name: r.student_name, className: r.class_name },
        partner: { id: r.partner_id, name: r.partner_name },
        kind: r.checkin_id ? ('checkin' as const) : ('missing' as const),
        checkIn:
          r.checkin_id && r.confirm_status && r.recorded_at
            ? {
                id: r.checkin_id,
                recordedAt: new Date(r.recorded_at).toISOString(),
                distanceM: r.distance_m ?? 0,
                accuracyM: r.accuracy_m,
                reviewReasons: r.review_reasons ?? [],
                late: r.late ?? false,
                confirmStatus: r.confirm_status,
                disputeReason: r.dispute_reason,
              }
            : null,
        status: r.status,
      })),
    };
  });
}

/**
 * POST /pkl/days/{sessionId}/decide: the guru pembimbing of the placement (or a manager) sets the
 * day's status. Allowed for a check-in in review or disputed, one decided before (replaced), or a day
 * without check-in up to today. A check-in waiting for or confirmed by the industry supervisor: 409.
 */
export function decideDay(actor: Actor, auditCtx: AuditContext, today: string, sessionId: string, input: DecidePklDayRequest, now = new Date()): Promise<PklDayDecision> {
  return withTenant(scope(actor), async (tx) => {
    const day = await pklDay(tx, sessionId);
    if (!day || (day.schoolMentorId !== actor.userId && !canManagePkl.allows(actor))) throw notFound();
    if (day.date > today) throw new ValidationError([{ path: 'sessionId', message: 'Hari PKL ini belum tiba.' }]);
    const checkin = await lockDayCheckin(tx, day.placementId, day.date);
    if (checkin?.confirmStatus === 'pending') throw new ConflictError('Check-in ini masih menunggu pembimbing industri.', { reason: 'pending_industry' });
    if (checkin?.confirmStatus === 'confirmed') throw new ConflictError('Check-in ini sudah dikonfirmasi pembimbing industri.', { reason: 'confirmed' });
    if (checkin) await markDecided(tx, checkin.id, input.status, actor.userId, now);
    await setPklStatus(tx, actor.schoolId, { sessionId, enrollmentId: day.enrollmentId, status: input.status, sourceRef: checkin?.id ?? null, recordedBy: actor.userId });
    await audit(tx, auditCtx, 'pkl.day_decided', { type: 'attendance_session', id: sessionId }, {
      before: { confirmStatus: checkin?.confirmStatus ?? null },
      after: { status: input.status, checkinId: checkin?.id ?? null },
    });
    return { sessionId, status: input.status };
  });
}

/**
 * Job pkl.missing-checkin (every 5 minutes, each school's clock): from 10.00 (or an hour after a later
 * opening) a student who has not checked in gets one reminder (pkl.checkin_missing); reminded_at on the
 * session keeps it to one. withPlatform only lists schools with running placements.
 */
export async function remindMissingCheckins(now = new Date(), logger?: Logger): Promise<number> {
  const schools = await withPlatform(async (tx) => {
    const res = await tx.execute<{ id: string; timezone: string }>(sql`
      select distinct s.id, s.timezone from pkl_placements p join schools s on s.id = p.school_id where p.status = 'active'`);
    return res.rows;
  });
  let reminded = 0;
  for (const school of schools) {
    try {
      const date = schoolDate(school.timezone, now);
      const minutes = schoolMinutes(school.timezone, now);
      reminded += await withTenant({ schoolId: school.id, userId: null }, async (tx) => {
        const due = (await missingCheckins(tx, date)).filter((m) => missingCheckinDue(minutes, m.startsAt));
        for (const m of due) await emit(tx, 'pkl.checkin_missing', { sessionId: m.sessionId });
        await markSessionsReminded(tx, due.map((m) => m.sessionId), now);
        return due.length;
      });
    } catch (err) {
      logger?.error({ err, schoolId: school.id }, 'pkl missing-checkin failed for school');
    }
  }
  return reminded;
}
