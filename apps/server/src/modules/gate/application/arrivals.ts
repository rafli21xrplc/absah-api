import type { Arrival, ArrivalBoard, GateToday, ManualArrivalRequest } from '@absah/contracts';
import { audit, type AuditContext } from '../../../shared/audit';
import { withTenant } from '../../../shared/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { schoolDate, schoolMinutes } from '../../../shared/school-date';
import { applyGateArrivals, schoolStartTime } from '../../attendance';
import { boardByClass } from '../domain/board';
import { canRecordArrivals, canSeeGateToday } from '../domain/policies';
import { activeStudent, excusedOn, studentsWithArrival } from '../infrastructure/arrival-repo';
import { insertScan } from '../infrastructure/scan-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const minutes = (hhmm: string) => Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3, 5));

/** Piket enters an arrival without a card scan (GRB-05): today only, reason required, audited. */
export function recordManualArrival(actor: Actor, auditCtx: AuditContext, timezone: string, input: ManualArrivalRequest): Promise<Arrival> {
  if (!canRecordArrivals.allows(actor)) throw new ForbiddenError('Kedatangan manual dicatat oleh guru piket.');
  const now = new Date();
  const arrivedAt = input.arrivedAt ? new Date(input.arrivedAt) : now;
  const today = schoolDate(timezone, now);
  if (arrivedAt > now || schoolDate(timezone, arrivedAt) !== today) {
    throw new ValidationError([{ path: 'arrivedAt', message: 'Jam datang harus hari ini dan tidak di masa depan.' }]);
  }
  return withTenant(scope(actor), async (tx) => {
    const student = await activeStudent(tx, input.enrollmentId);
    if (!student) throw new NotFoundError('Siswa tidak ditemukan.');
    const lateAfter = await schoolStartTime(tx, today);
    const outcome = schoolMinutes(timezone, arrivedAt) <= minutes(lateAfter) ? ('on_time' as const) : ('late' as const);
    const id = await insertScan(tx, {
      schoolId: actor.schoolId,
      schoolDate: today,
      scannedAt: arrivedAt,
      method: 'manual',
      result: 'accepted',
      outcome,
      enrollmentId: student.enrollmentId,
      recordedBy: actor.userId,
      reason: input.reason,
    });
    if (!id) throw new ConflictError(`${student.name} sudah tercatat datang hari ini.`, { reason: 'already_arrived' });
    await applyGateArrivals(tx, actor.schoolId, timezone, { schoolDate: today, enrollmentId: student.enrollmentId });
    await audit(tx, auditCtx, 'gate.manual_arrival', { type: 'gate_scan', id }, { after: { enrollmentId: student.enrollmentId, outcome, reason: input.reason } });
    return { ...student, arrivedAt: arrivedAt.toISOString(), outcome, method: 'manual', reason: input.reason };
  });
}

/** Late arrivals and students not in yet (GRB-06), excused ones flagged. */
export function gateToday(actor: Actor, timezone: string): Promise<GateToday> {
  if (!canSeeGateToday.allows(actor)) throw new ForbiddenError('Halaman gerbang untuk guru piket dan pimpinan sekolah.');
  return withTenant(scope(actor), async (tx) => {
    const today = schoolDate(timezone);
    const rows = await studentsWithArrival(tx, today);
    const excused = await excusedOn(tx, today);
    const late: Arrival[] = rows.flatMap((r) =>
      r.arrivedAt && r.outcome === 'late' && r.method
        ? [{ enrollmentId: r.enrollmentId, name: r.name, className: r.className, arrivedAt: r.arrivedAt.toISOString(), outcome: r.outcome, method: r.method, reason: r.reason }]
        : [],
    );
    const notArrived = rows.filter((r) => !r.arrivedAt).map((r) => ({ enrollmentId: r.enrollmentId, name: r.name, className: r.className, leave: excused.get(r.enrollmentId) ?? null }));
    return {
      schoolDate: today,
      lateAfter: await schoolStartTime(tx, today),
      counts: { students: rows.length, arrived: rows.length - notArrived.length, late: late.length, notArrived: notArrived.length },
      late: late.sort((a, b) => a.arrivedAt.localeCompare(b.arrivedAt)),
      notArrived,
    };
  });
}

/** GRB-08: the counts the live board polls, per rombel; no names, so it stays small for 900 students. */
export function arrivalBoard(actor: Actor, timezone: string): Promise<ArrivalBoard> {
  if (!canSeeGateToday.allows(actor)) throw new ForbiddenError('Papan kedatangan untuk guru piket dan pimpinan sekolah.');
  return withTenant(scope(actor), async (tx) => {
    const now = new Date();
    const today = schoolDate(timezone, now);
    const rows = await studentsWithArrival(tx, today);
    const excused = await excusedOn(tx, today);
    const { classes, totals } = boardByClass(rows.map((r) => ({ className: r.className, arrived: r.arrivedAt !== null, late: r.outcome === 'late', excused: excused.has(r.enrollmentId) })));
    return { schoolDate: today, lateAfter: await schoolStartTime(tx, today), updatedAt: now.toISOString(), totals, classes };
  });
}
