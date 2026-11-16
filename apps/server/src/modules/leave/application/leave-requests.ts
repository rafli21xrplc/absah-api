import type {
  CreateLeaveAttachmentRequest,
  CreateLeaveAttachmentResponse,
  CreateLeaveRequest,
  DecideLeaveRequest,
  LeaveAttachmentLink,
  LeaveKind,
  LeaveRequest,
  LeaveRequestList,
  LeaveRequestListQuery,
  LeaveStudentList,
} from '@absah/contracts';
import type { Tx } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { withTenant } from '../../../shared/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../../shared/errors';
import { emit } from '../../../shared/outbox';
import { anyRole, type Actor } from '../../../shared/policy';
import { storageKey, type ObjectStorage } from '../../../shared/storage';
import { checkLeaveDates } from '../domain/leave-rules';
import { canDecideAnyLeave, mayDecideLeave } from '../domain/policies';
import { findStudent, hasOverlap, insertLeave, listLeaves, lockLeave, lockStudentLeave, requestableStudents, updateLeave, type LeaveRow } from '../infrastructure/leave-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const isParent = anyRole('orang_tua');
const mayUpload = anyRole('orang_tua', 'guru', 'wali_kelas', 'wakasek', 'kepsek');
const NOT_FOUND = 'Izin tidak ditemukan.';

function toLeaveRequest(row: LeaveRow): LeaveRequest {
  const ref = (id: string | null, name: string | null) => (id ? { id, name: name ?? 'Pengguna' } : null);
  return {
    id: row.id,
    student: { enrollmentId: row.enrollmentId, name: row.studentName, className: row.className },
    kind: row.kind,
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    reason: row.reason.reveal(),
    hasAttachment: row.attachmentKey !== null,
    status: row.status,
    // A guardian who asked through an action link has no account; show their name from the roster.
    requestedBy: row.requestedBy ? ref(row.requestedBy, row.requestedByName) : ref(row.requestedByGuardianId, row.requestedByGuardianName && `${row.requestedByGuardianName} (tautan WhatsApp)`),
    decidedBy: ref(row.decidedBy, row.decidedByName),
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

/** One request the actor can see (wakasek/kepsek: all; others: own, rombel, children). */
async function visibleLeave(tx: Tx, actor: Actor, id: string): Promise<LeaveRow> {
  const [row] = await listLeaves(tx, { id, ...(canDecideAnyLeave.allows(actor) ? {} : { visibleTo: actor.userId }) });
  if (!row) throw new NotFoundError(NOT_FOUND);
  return row;
}

export async function createLeaveAttachment(actor: Actor, storage: ObjectStorage, input: CreateLeaveAttachmentRequest): Promise<CreateLeaveAttachmentResponse> {
  if (!mayUpload.allows(actor)) throw new ForbiddenError('Lampiran izin diunggah oleh orang tua atau wali kelas.');
  const attachmentId = uuidv7();
  const upload = await storage.presignUpload({ key: storageKey(actor.schoolId, 'leave', attachmentId), contentType: input.contentType, contentLength: input.fileSize });
  return { attachmentId, upload: { ...upload, expiresAt: upload.expiresAt.toISOString() } };
}

export function getRequestableStudents(actor: Actor): Promise<LeaveStudentList> {
  return withTenant(scope(actor), async (tx) => ({ items: await requestableStudents(tx, actor.userId, canDecideAnyLeave.allows(actor)) }));
}

/**
 * A parent's request waits for the wali kelas; one by the wali kelas (or wakasek/kepsek), e.g. after
 * a phone call, is approved at once. One izin per student per day.
 */
export async function createLeave(actor: Actor, auditCtx: AuditContext, storage: ObjectStorage, today: string, input: CreateLeaveRequest): Promise<LeaveRequest> {
  const problems = checkLeaveDates(input, today);
  if (problems.length) throw new ValidationError(problems);
  const attachmentKey = input.attachment ? storageKey(actor.schoolId, 'leave', input.attachment.id) : null;
  if (attachmentKey && !(await storage.read(attachmentKey))) throw new ValidationError([{ path: 'attachment', message: 'Lampiran belum terunggah. Unggah ulang.' }]);

  return withTenant(scope(actor), async (tx) => {
    await lockStudentLeave(tx, input.enrollmentId);
    const student = await findStudent(tx, input.enrollmentId, actor.userId);
    const byStaff = student ? mayDecideLeave(actor, student) : false;
    const byParent = student ? isParent.allows(actor) && student.isGuardian : false;
    if (!student || student.status !== 'active' || !(byStaff || byParent)) throw new NotFoundError('Siswa tidak ditemukan.');
    if (await hasOverlap(tx, input.enrollmentId, input)) throw new ConflictError('Sudah ada izin untuk siswa ini pada tanggal tersebut.', { reason: 'overlap' });

    const status = byStaff ? 'approved' : 'pending';
    const id = await insertLeave(tx, {
      schoolId: actor.schoolId,
      enrollmentId: input.enrollmentId,
      kind: input.kind,
      startsOn: input.startsOn,
      endsOn: input.endsOn,
      reason: input.reason,
      attachmentKey,
      attachmentType: input.attachment?.contentType ?? null,
      status,
      requestedBy: actor.userId,
      decidedBy: byStaff ? actor.userId : null,
      decidedAt: byStaff ? new Date() : null,
    });
    await emit(tx, byStaff ? 'leave.approved' : 'leave.requested', { leaveRequestId: id });
    await audit(tx, auditCtx, byStaff ? 'leave.approved' : 'leave.requested', { type: 'leave_request', id }, {
      after: { enrollmentId: input.enrollmentId, kind: input.kind, startsOn: input.startsOn, endsOn: input.endsOn, status },
    });
    return toLeaveRequest(await visibleLeave(tx, actor, id));
  });
}

export function getLeaves(actor: Actor, query: LeaveRequestListQuery): Promise<LeaveRequestList> {
  return withTenant(scope(actor), async (tx) => {
    const rows = await listLeaves(tx, {
      ...(query.status === 'all' ? {} : { status: query.status }),
      ...(canDecideAnyLeave.allows(actor) ? {} : { visibleTo: actor.userId }),
    });
    return { items: rows.map(toLeaveRequest) };
  });
}

export function getLeave(actor: Actor, id: string): Promise<LeaveRequest> {
  return withTenant(scope(actor), async (tx) => toLeaveRequest(await visibleLeave(tx, actor, id)));
}

export async function decideLeave(actor: Actor, auditCtx: AuditContext, id: string, input: DecideLeaveRequest): Promise<LeaveRequest> {
  return withTenant(scope(actor), async (tx) => {
    const locked = await lockLeave(tx, id);
    const row = locked ? await visibleLeave(tx, actor, id) : null;
    if (!locked || !row) throw new NotFoundError(NOT_FOUND);
    if (!mayDecideLeave(actor, row)) throw new ForbiddenError('Izin diputuskan oleh wali kelas.');
    if (locked.status !== 'pending') throw new ConflictError('Izin ini sudah diputuskan.');

    const status = input.approve ? 'approved' : 'rejected';
    await updateLeave(tx, id, { status, decidedBy: actor.userId, decidedAt: new Date(), decisionNote: input.note ?? null });
    await emit(tx, input.approve ? 'leave.approved' : 'leave.rejected', { leaveRequestId: id });
    await audit(tx, auditCtx, `leave.${status}`, { type: 'leave_request', id }, { before: { status: 'pending' }, after: { status } });
    return toLeaveRequest(await visibleLeave(tx, actor, id));
  });
}

/** The requester or a decider withdraws a pending or approved izin; attendance falls back. */
export async function cancelLeave(actor: Actor, auditCtx: AuditContext, id: string): Promise<LeaveRequest> {
  return withTenant(scope(actor), async (tx) => {
    const locked = await lockLeave(tx, id);
    const row = locked ? await visibleLeave(tx, actor, id) : null;
    if (!locked || !row) throw new NotFoundError(NOT_FOUND);
    if (locked.requestedBy !== actor.userId && !mayDecideLeave(actor, row)) throw new ForbiddenError('Izin dibatalkan oleh pengaju atau wali kelas.');
    if (locked.status !== 'pending' && locked.status !== 'approved') throw new ConflictError('Izin ini tidak bisa dibatalkan lagi.');

    await updateLeave(tx, id, { status: 'cancelled', cancelledBy: actor.userId, cancelledAt: new Date() });
    if (locked.status === 'approved') await emit(tx, 'leave.cancelled', { leaveRequestId: id });
    await audit(tx, auditCtx, 'leave.cancelled', { type: 'leave_request', id }, { before: { status: locked.status }, after: { status: 'cancelled' } });
    return toLeaveRequest(await visibleLeave(tx, actor, id));
  });
}

export async function leaveAttachmentLink(actor: Actor, storage: ObjectStorage, id: string): Promise<LeaveAttachmentLink> {
  const row = await withTenant(scope(actor), (tx) => visibleLeave(tx, actor, id));
  if (!row.attachmentKey || !row.attachmentType) throw new NotFoundError('Izin ini tanpa lampiran.');
  const link = await storage.presignDownload({ key: row.attachmentKey, contentType: row.attachmentType });
  return { url: link.url, expiresAt: link.expiresAt.toISOString() };
}

/**
 * An izin asked by a guardian through an action link (ORT-01): no account, so the guardian is the
 * requester. Always pending for the wali kelas. Runs in the caller's tenant transaction, which also
 * spends the link's one write.
 */
export async function requestLeaveAsGuardian(
  tx: Tx,
  auditCtx: AuditContext,
  today: string,
  input: { enrollmentId: string; guardianId: string; kind: LeaveKind; startsOn: string; endsOn: string; reason: string },
): Promise<{ id: string; status: 'pending' }> {
  const problems = checkLeaveDates(input, today);
  if (problems.length) throw new ValidationError(problems);
  await lockStudentLeave(tx, input.enrollmentId);
  if (await hasOverlap(tx, input.enrollmentId, input)) throw new ConflictError('Sudah ada izin untuk siswa ini pada tanggal tersebut.', { reason: 'overlap' });
  const id = await insertLeave(tx, {
    schoolId: auditCtx.schoolId,
    enrollmentId: input.enrollmentId,
    kind: input.kind,
    startsOn: input.startsOn,
    endsOn: input.endsOn,
    reason: input.reason,
    attachmentKey: null,
    attachmentType: null,
    status: 'pending',
    requestedBy: null,
    requestedByGuardianId: input.guardianId,
    decidedBy: null,
    decidedAt: null,
  });
  await emit(tx, 'leave.requested', { leaveRequestId: id });
  await audit(tx, auditCtx, 'leave.requested', { type: 'leave_request', id }, {
    after: { enrollmentId: input.enrollmentId, kind: input.kind, startsOn: input.startsOn, endsOn: input.endsOn, status: 'pending', via: 'action_link', guardianId: input.guardianId },
  });
  return { id, status: 'pending' };
}
