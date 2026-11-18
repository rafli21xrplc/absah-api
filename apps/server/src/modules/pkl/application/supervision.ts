import { PKL_AUTO_CONFIRM_HOURS, type ConfirmPklCheckinsRequest, type DisputePklCheckinRequest, type PklSupervisionDay } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { sql } from 'drizzle-orm';
import type { Logger } from 'pino';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withPlatform, withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { schoolDate } from '../../../shared/school-date';
import { openPklSession, setPklStatus } from '../../attendance';
import { confirmedStatus } from '../domain/checkin-rules';
import { canSuperviseAtDudi } from '../domain/policies';
import { lockCheckin, lockPendingBefore, lockPendingOfMentor, markConfirmed, markDisputed, mentorCheckins, supervisedOn, type PendingCheckin } from '../infrastructure/confirm-repo';
import { checkinStatus } from './checkins';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });

function dayOf(timezone: string, date: string | undefined, now: Date): string {
  const today = schoolDate(timezone, now);
  if (date && date > today) throw new ValidationError([{ path: 'date', message: 'Tanggal tidak boleh di masa depan.' }]);
  return date ?? today;
}

async function day(tx: Tx, mentorId: string, date: string): Promise<PklSupervisionDay> {
  const { rows, checkins } = await supervisedOn(tx, mentorId, date);
  const items = rows.map((r) => {
    const ci = checkins.find((c) => c.placementId === r.placementId && c.kind === 'in');
    const co = checkins.find((c) => c.placementId === r.placementId && c.kind === 'out');
    return {
      placementId: r.placementId,
      student: { name: r.name, className: r.className },
      checkIn: ci?.confirmStatus
        ? { id: ci.id, recordedAt: ci.recordedAt.toISOString(), confirmStatus: ci.confirmStatus, late: ci.late, status: checkinStatus(ci), disputeReason: ci.disputeReason }
        : null,
      checkOut: co ? { recordedAt: co.recordedAt.toISOString() } : null,
    };
  });
  return { date, pending: items.filter((i) => i.checkIn?.confirmStatus === 'pending').length, items };
}

/** Confirmed check-ins become the day's status: H, or T after opening time (source pkl_confirm). */
async function applyConfirmations(tx: Tx, schoolId: string, rows: PendingCheckin[], by: string | null, at: Date): Promise<void> {
  await markConfirmed(tx, rows.map((r) => r.id), by, at);
  for (const r of rows) {
    const sessionId = await openPklSession(tx, schoolId, r.placementId, r.schoolDate);
    await setPklStatus(tx, schoolId, { sessionId, enrollmentId: r.enrollmentId, status: confirmedStatus(r.late), sourceRef: r.id, recordedBy: by });
  }
}

/** GET /pkl/supervision: the industry supervisor's students on a date (statuses only). */
export function supervisionDay(actor: Actor, timezone: string, date?: string, now = new Date()): Promise<PklSupervisionDay> {
  authorize(actor, canSuperviseAtDudi);
  const d = dayOf(timezone, date, now);
  return withTenant(scope(actor), (tx) => day(tx, actor.userId, d));
}

/**
 * POST /pkl/checkins/confirm: one click confirms every pending check-in of the supervisor's students
 * that day (or the listed ones). Check-ins of another supervisor's students answer 404 and nothing is
 * written; ones already confirmed or in review are left as they are.
 */
export function confirmCheckins(actor: Actor, auditCtx: AuditContext, timezone: string, input: ConfirmPklCheckinsRequest, now = new Date()): Promise<PklSupervisionDay> {
  authorize(actor, canSuperviseAtDudi);
  const d = dayOf(timezone, input.date, now);
  return withTenant(scope(actor), async (tx) => {
    if (input.checkinIds) {
      const mine = await mentorCheckins(tx, actor.userId, input.checkinIds);
      if (mine.length !== new Set(input.checkinIds).size || mine.some((m) => m.schoolDate !== d)) throw new NotFoundError('Check-in tidak ditemukan.');
    }
    const rows = await lockPendingOfMentor(tx, actor.userId, d, input.checkinIds);
    await applyConfirmations(tx, actor.schoolId, rows, actor.userId, now);
    if (rows.length > 0) {
      await audit(tx, auditCtx, 'pkl.checkins_confirmed', { type: 'pkl_checkin', id: rows[0]?.id ?? '' }, { after: { date: d, checkinIds: rows.map((r) => r.id) } });
    }
    return day(tx, actor.userId, d);
  });
}

/** POST /pkl/checkins/{id}/dispute: a pending check-in goes to the guru pembimbing with the reason. */
export function disputeCheckin(actor: Actor, auditCtx: AuditContext, id: string, input: DisputePklCheckinRequest, now = new Date()): Promise<PklSupervisionDay> {
  authorize(actor, canSuperviseAtDudi);
  return withTenant(scope(actor), async (tx) => {
    const row = await lockCheckin(tx, id);
    if (!row || row.kind !== 'in' || row.industryMentorId !== actor.userId) throw new NotFoundError('Check-in tidak ditemukan.');
    if (row.confirmStatus !== 'pending') throw new ConflictError('Check-in ini sudah tidak menunggu konfirmasi.', { reason: 'not_pending' });
    await markDisputed(tx, id, actor.userId, input.reason, now);
    await audit(tx, auditCtx, 'pkl.checkin_disputed', { type: 'pkl_checkin', id }, { before: { confirmStatus: 'pending' }, after: { confirmStatus: 'disputed' } });
    return day(tx, actor.userId, row.schoolDate);
  });
}

/**
 * Job pkl.auto-confirm (hourly): check-ins pending for 24 hours without a dispute are confirmed
 * (confirmed_by null). withPlatform only finds the schools with such rows; the work runs in withTenant.
 */
export async function autoConfirmDue(now = new Date(), logger?: Logger): Promise<number> {
  const before = new Date(now.getTime() - PKL_AUTO_CONFIRM_HOURS * 3_600_000);
  const schools = await withPlatform(async (tx) => {
    const res = await tx.execute<{ school_id: string }>(
      sql`select distinct school_id from pkl_checkins where confirm_status = 'pending' and recorded_at < ${before.toISOString()}::timestamptz`,
    );
    return res.rows.map((r) => r.school_id);
  });
  let confirmed = 0;
  for (const schoolId of schools) {
    try {
      confirmed += await withTenant({ schoolId, userId: null }, async (tx) => {
        const rows = await lockPendingBefore(tx, before);
        await applyConfirmations(tx, schoolId, rows, null, now);
        return rows.length;
      });
    } catch (err) {
      logger?.error({ err, schoolId }, 'pkl auto-confirm failed for school');
    }
  }
  return confirmed;
}
