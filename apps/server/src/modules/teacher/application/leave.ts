import type { CreateTeacherLeaveRequest, DecideTeacherLeaveRequest, TeacherLeave, TeacherLeaveList, TeacherLeavesQuery } from '@absah/contracts';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../../shared/errors';
import { emit } from '../../../shared/outbox';
import type { Actor } from '../../../shared/policy';
import { checkTeacherLeaveDates, mayCancelLeave } from '../domain/leave-rules';
import { canDecideTeacherLeave, canRequestTeacherLeave, canSeeAllTeacherLeaves } from '../domain/policies';
import { hasOverlap, insertLeave, listLeaves, lockLeave, lockTeacherLeaves, type TeacherLeaveRow, updateLeave } from '../infrastructure/leave-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const NOT_FOUND = 'Izin tidak ditemukan.';

function view(r: TeacherLeaveRow): TeacherLeave {
  return {
    id: r.id,
    teacher: { id: r.userId, name: r.teacherName ?? 'Pengguna' },
    kind: r.kind,
    startsOn: r.startsOn,
    endsOn: r.endsOn,
    reason: r.reason.reveal(),
    status: r.status,
    decidedBy: r.decidedBy ? { id: r.decidedBy, name: r.decidedByName ?? 'Pengguna' } : null,
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
    cancelledAt: r.cancelledAt?.toISOString() ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** The deciders see any izin; everyone else only their own (404 otherwise, so another teacher's izin is not confirmed to exist). */
async function visibleLeave(tx: Parameters<typeof listLeaves>[0], actor: Actor, id: string): Promise<TeacherLeaveRow> {
  const [row] = await listLeaves(tx, { id, ...(canSeeAllTeacherLeaves.allows(actor) ? {} : { userId: actor.userId }) });
  if (!row) throw new NotFoundError(NOT_FOUND);
  return row;
}

/** POST /teacher-leaves: always pending; the wakasek decides. The reason never enters the audit log. */
export function requestTeacherLeave(actor: Actor, auditCtx: AuditContext, today: string, input: CreateTeacherLeaveRequest): Promise<TeacherLeave> {
  authorize(actor, canRequestTeacherLeave);
  const problems = checkTeacherLeaveDates(input, today);
  if (problems.length) throw new ValidationError(problems);
  return withTenant(scope(actor), async (tx) => {
    await lockTeacherLeaves(tx, actor.userId);
    if (await hasOverlap(tx, actor.userId, input)) throw new ConflictError('Sudah ada izin pada tanggal tersebut.', { reason: 'overlap' });
    const id = uuidv7();
    await insertLeave(tx, { id, schoolId: actor.schoolId, userId: actor.userId, ...input });
    await emit(tx, 'teacher.leave_requested', { teacherLeaveId: id });
    await audit(tx, auditCtx, 'teacher.leave_requested', { type: 'teacher_leave', id }, { after: { kind: input.kind, startsOn: input.startsOn, endsOn: input.endsOn, status: 'pending' } });
    return view(await visibleLeave(tx, actor, id));
  });
}

/** GET /teacher-leaves: the deciders list everyone's (or their own with mine); others their own. */
export function listTeacherLeaves(actor: Actor, query: TeacherLeavesQuery): Promise<TeacherLeaveList> {
  return withTenant(scope(actor), async (tx) => {
    const everyone = canSeeAllTeacherLeaves.allows(actor) && !query.mine;
    if (!everyone) authorize(actor, canRequestTeacherLeave);
    const rows = await listLeaves(tx, { ...(query.status === 'all' ? {} : { status: query.status }), ...(everyone ? {} : { userId: actor.userId }) });
    return { items: rows.map(view) };
  });
}

/** POST /teacher-leaves/{id}/decide: the wakasek, kepsek or admin, never on their own izin. */
export function decideTeacherLeave(actor: Actor, auditCtx: AuditContext, id: string, input: DecideTeacherLeaveRequest): Promise<TeacherLeave> {
  authorize(actor, canDecideTeacherLeave);
  return withTenant(scope(actor), async (tx) => {
    const locked = await lockLeave(tx, id);
    if (!locked) throw new NotFoundError(NOT_FOUND);
    if (locked.userId === actor.userId) throw new ForbiddenError('Izin sendiri diputuskan oleh atasan.');
    if (locked.status !== 'pending') throw new ConflictError('Izin ini sudah diputuskan.', { reason: 'already_decided' });
    const status = input.approve ? 'approved' : 'rejected';
    await updateLeave(tx, id, { status, decidedBy: actor.userId, decidedAt: new Date(), decisionNote: input.note ?? null });
    await emit(tx, 'teacher.leave_decided', { teacherLeaveId: id, approved: input.approve });
    await audit(tx, auditCtx, `teacher.leave_${status}`, { type: 'teacher_leave', id }, { before: { status: 'pending' }, after: { status } });
    return view(await visibleLeave(tx, actor, id));
  });
}

/** POST /teacher-leaves/{id}/cancel: the teacher withdraws their own izin while it is pending or still running or ahead. */
export function cancelTeacherLeave(actor: Actor, auditCtx: AuditContext, today: string, id: string): Promise<TeacherLeave> {
  authorize(actor, canRequestTeacherLeave);
  return withTenant(scope(actor), async (tx) => {
    const locked = await lockLeave(tx, id);
    if (!locked || locked.userId !== actor.userId) throw new NotFoundError(NOT_FOUND);
    if (!mayCancelLeave(locked, today)) throw new ConflictError('Izin ini tidak bisa dibatalkan lagi.', { reason: 'not_cancellable' });
    await updateLeave(tx, id, { status: 'cancelled', cancelledAt: new Date() });
    await audit(tx, auditCtx, 'teacher.leave_cancelled', { type: 'teacher_leave', id }, { before: { status: locked.status }, after: { status: 'cancelled' } });
    return view(await visibleLeave(tx, actor, id));
  });
}
