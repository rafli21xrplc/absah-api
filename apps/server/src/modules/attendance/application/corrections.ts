import type { Correction, CorrectionList, CorrectionListQuery, CreateCorrectionsRequest, DecideCorrectionRequest } from '@absah/contracts';
import { audit, type AuditContext } from '../../../shared/audit';
import { withTenant } from '../../../shared/db';
import { ConflictError, ForbiddenError, NotFoundError, ValidationError } from '../../../shared/errors';
import { emit } from '../../../shared/outbox';
import { isUniqueViolation } from '../../../shared/pg-errors';
import type { Actor } from '../../../shared/policy';
import { canDecideCorrections, mayFillSession, mayViewSession } from '../domain/policies';
import { listSessions, recordsOf, roster, upsertRecords } from '../infrastructure/attendance-repo';
import { decideCorrection, insertCorrections, listCorrections, lockCorrection, type CorrectionRow } from '../infrastructure/correction-repo';
import { recomputeDaily } from '../infrastructure/session-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const ref = (id: string | null, name: string | null) => (id ? { id, name: name ?? '' } : null);

function toCorrection(r: CorrectionRow): Correction {
  return {
    id: r.id,
    session: { id: r.sessionId, schoolDate: r.schoolDate, ownerName: r.ownerName, subject: r.subject, period: r.period },
    student: { enrollmentId: r.enrollmentId, name: r.studentName, className: r.className },
    fromStatus: r.fromStatus,
    toStatus: r.toStatus,
    reason: r.reason,
    status: r.status,
    requestedBy: ref(r.requestedBy, r.requestedByName),
    decidedBy: ref(r.decidedBy, r.decidedByName),
    decidedAt: r.decidedAt?.toISOString() ?? null,
    decisionNote: r.decisionNote,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Whoever may fill the session asks to change students of it once it is locked. */
export async function requestCorrections(actor: Actor, sessionId: string, input: CreateCorrectionsRequest): Promise<CorrectionList> {
  try {
    return await withTenant(scope(actor), async (tx) => {
      const [session] = await listSessions(tx, { id: sessionId });
      if (!session || !mayViewSession(actor, session)) throw new NotFoundError('Sesi tidak ditemukan.');
      if (!mayFillSession(actor, session)) throw new ForbiddenError('Koreksi diajukan oleh guru pengampu atau wali kelas.');
      if (!session.lockedAt) throw new ConflictError('Sesi belum dikunci. Ubah langsung dari layar isi sesi.', { reason: 'not_locked' });

      const onRoster = new Set((await roster(tx, session)).map((st) => st.enrollmentId));
      const current = new Map((await recordsOf(tx, sessionId)).map((r) => [r.enrollmentId, r.status]));
      const ids = input.changes.map((ch) => ch.enrollmentId);
      if (new Set(ids).size !== ids.length || ids.some((id) => !onRoster.has(id))) {
        throw new ValidationError([{ path: 'changes', message: 'Siswa harus terdaftar di sesi ini dan hanya sekali.' }]);
      }
      const changes = input.changes.filter((ch) => current.get(ch.enrollmentId) !== ch.status);
      if (changes.length === 0) throw new ValidationError([{ path: 'changes', message: 'Status yang diajukan sama dengan yang tercatat.' }]);

      const created = await insertCorrections(
        tx,
        changes.map((ch) => ({
          schoolId: actor.schoolId,
          sessionId,
          enrollmentId: ch.enrollmentId,
          fromStatus: current.get(ch.enrollmentId) ?? null,
          toStatus: ch.status,
          reason: input.reason,
          requestedBy: actor.userId,
        })),
      );
      return { items: (await listCorrections(tx, { ids: created })).map(toCorrection) };
    });
  } catch (err) {
    if (isUniqueViolation(err, 'correction_requests_pending_key')) throw new ConflictError('Sudah ada koreksi yang menunggu untuk siswa ini.');
    throw err;
  }
}

export async function getCorrections(actor: Actor, query: CorrectionListQuery): Promise<CorrectionList> {
  const status = query.status === 'all' ? undefined : query.status;
  const rows = await withTenant(scope(actor), (tx) =>
    listCorrections(tx, { ...(status ? { status } : {}), ...(canDecideCorrections.allows(actor) ? {} : { requestedBy: actor.userId }) }),
  );
  return { items: rows.map(toCorrection) };
}

/**
 * Approval writes the requested status with source manual (above every other source), recomputes
 * the student's day, audits the change, and tells parents again when the student becomes alpa.
 */
export async function decide(actor: Actor, auditCtx: AuditContext, correctionId: string, input: DecideCorrectionRequest): Promise<Correction> {
  if (!canDecideCorrections.allows(actor)) throw new ForbiddenError('Koreksi diputuskan oleh wakasek atau kepala sekolah.');
  return withTenant(scope(actor), async (tx) => {
    const row = await lockCorrection(tx, correctionId);
    if (!row) throw new NotFoundError('Koreksi tidak ditemukan.');
    if (row.status !== 'pending') throw new ConflictError('Koreksi ini sudah diputuskan.');
    if (row.requestedBy === actor.userId) throw new ForbiddenError('Koreksi tidak bisa diputuskan oleh pengajunya sendiri.');

    const status = input.approve ? 'approved' : 'rejected';
    await decideCorrection(tx, correctionId, { status, decidedBy: actor.userId, decisionNote: input.note ?? null });
    if (input.approve) {
      const before = (await recordsOf(tx, row.sessionId)).find((r) => r.enrollmentId === row.enrollmentId);
      await upsertRecords(tx, [
        { schoolId: actor.schoolId, sessionId: row.sessionId, enrollmentId: row.enrollmentId, status: row.toStatus, source: 'manual', sourceRef: row.id, recordedBy: actor.userId },
      ]);
      const [session] = await listSessions(tx, { id: row.sessionId });
      if (session) await recomputeDaily(tx, actor.schoolId, session.schoolDate, [row.enrollmentId]);
      if (row.toStatus === 'A' && before?.status !== 'A') await emit(tx, 'attendance.absent_marked', { sessionId: row.sessionId, enrollmentId: row.enrollmentId });
      await audit(tx, auditCtx, 'attendance.corrected', { type: 'attendance_record', id: row.id }, {
        before: { status: before?.status ?? null, source: before?.source ?? null },
        after: { status: row.toStatus, source: 'manual', sessionId: row.sessionId, enrollmentId: row.enrollmentId },
      });
    }
    const [updated] = await listCorrections(tx, { id: correctionId });
    if (!updated) throw new Error('correction vanished');
    return toCorrection(updated);
  });
}
