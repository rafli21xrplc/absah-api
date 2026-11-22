import {
  POINT_ENTRY_MAX_BACKDATE_DAYS,
  type CreatePointEntryRequest,
  type CreatePointEvidenceRequest,
  type CreatePointEvidenceResponse,
  type PointEntry,
  type PointEvidenceLink,
  type PointStudentList,
  type ReversePointEntryRequest,
  type StudentPoints,
} from '@absah/contracts';
import type { Tx } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import { isUniqueViolation } from '../../../shared/pg-errors';
import type { Actor } from '../../../shared/policy';
import { addDays } from '../../../shared/school-date';
import { storageKey, type ObjectStorage } from '../../../shared/storage';
import { canReadStudentPoints, canRecordPoints, canReversePoints, canSeeAllPoints } from '../domain/policies';
import { searchStudents } from '../infrastructure/uks-repo';
import { lockStudentPoints } from '../infrastructure/followup-repo';
import { entriesOf, findEnrollment, findEntry, insertEntry, totalsOf, type EntryRow } from '../infrastructure/point-entry-repo';
import { raiseThresholdTasks } from './followups';
import { findRule } from '../infrastructure/point-rule-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const REVERSED_KEY = 'point_entries_reverses_entry_id_key';
const studentNotFound = () => new NotFoundError('Siswa tidak ditemukan.');
const entryNotFound = () => new NotFoundError('Catatan poin tidak ditemukan.');

/** The note is decrypted only here, for the roles that may read a student's profile. */
function view(r: EntryRow): PointEntry {
  return {
    id: r.id,
    enrollmentId: r.enrollmentId,
    kind: r.kind,
    category: r.category,
    rule: r.ruleName,
    points: r.points,
    date: r.occurredOn,
    note: r.note?.reveal() ?? null,
    hasEvidence: r.evidenceKey !== null,
    reversesEntryId: r.reversesEntryId,
    reversed: r.reversed,
    recordedBy: r.recordedById ? { id: r.recordedById, name: r.recordedByName ?? '' } : null,
    createdAt: r.createdAt.toISOString(),
  };
}

/** Leaders see every student; a wali kelas only the class they lead. Anyone else gets 404, as if it did not exist. */
async function readableStudent(tx: Tx, actor: Actor, enrollmentId: string) {
  authorize(actor, canReadStudentPoints);
  const student = await findEnrollment(tx, enrollmentId);
  if (!student) throw studentNotFound();
  if (!canSeeAllPoints.allows(actor) && student.homeroomTeacherId !== actor.userId) throw studentNotFound();
  return student;
}

/** The student's net pelanggaran points so far as a positive number, after taking the per-student lock. */
async function violationTotalLocked(tx: Tx, enrollmentId: string): Promise<number> {
  await lockStudentPoints(tx, enrollmentId);
  return -(await totalsOf(tx, enrollmentId)).violationPoints;
}

/** GET /point-entries/students?q=: whoever may record points finds the student by name (the registry is closed to teachers). */
export function findPointStudents(actor: Actor, text: string): Promise<PointStudentList> {
  authorize(actor, canRecordPoints);
  return withTenant(scope(actor), async (tx) => ({ items: await searchStudents(tx, text) }));
}

/** POST /point-entries/evidence: presigned PUT under schools/{id}/ksw/{uuid}. */
export async function createPointEvidence(actor: Actor, storage: ObjectStorage, input: CreatePointEvidenceRequest): Promise<CreatePointEvidenceResponse> {
  authorize(actor, canRecordPoints);
  const evidenceId = uuidv7();
  const upload = await storage.presignUpload({ key: storageKey(actor.schoolId, 'ksw', evidenceId), contentType: input.contentType, contentLength: input.fileSize });
  return { evidenceId, upload: { ...upload, expiresAt: upload.expiresAt.toISOString() } };
}

/**
 * POST /point-entries: records a pelanggaran or prestasi against an active student, today or up to
 * POINT_ENTRY_MAX_BACKDATE_DAYS back. Title, category and points are copied from the rule (which must
 * be switched on). The audit entry keeps ids and points, never the note.
 */
export async function recordPointEntry(actor: Actor, auditCtx: AuditContext, storage: ObjectStorage, today: string, input: CreatePointEntryRequest): Promise<PointEntry> {
  authorize(actor, canRecordPoints);
  const date = input.date ?? today;
  if (date > today) throw new ValidationError([{ path: 'date', message: 'Tanggal tidak boleh di masa depan.' }]);
  if (date < addDays(today, -POINT_ENTRY_MAX_BACKDATE_DAYS)) {
    throw new ValidationError([{ path: 'date', message: `Pencatatan hanya bisa sampai ${POINT_ENTRY_MAX_BACKDATE_DAYS} hari ke belakang.` }]);
  }
  const evidenceKey = input.evidence ? storageKey(actor.schoolId, 'ksw', input.evidence.id) : null;
  if (evidenceKey && !(await storage.read(evidenceKey))) throw new ValidationError([{ path: 'evidence', message: 'Bukti belum terunggah. Unggah ulang.' }]);

  return withTenant(scope(actor), async (tx) => {
    const student = await findEnrollment(tx, input.enrollmentId);
    if (!student || student.status !== 'active') throw studentNotFound();
    const rule = await findRule(tx, input.ruleId);
    if (!rule) throw new NotFoundError('Aturan tidak ditemukan.');
    if (!rule.active) throw new ConflictError('Aturan ini sudah dinonaktifkan.', { reason: 'rule_inactive' });
    const id = uuidv7();
    // Only a pelanggaran can cross a tier; the lock makes the "before" total include any entry recorded at the same moment.
    const before = rule.kind === 'violation' ? await violationTotalLocked(tx, input.enrollmentId) : 0;
    await insertEntry(tx, {
      id,
      schoolId: actor.schoolId,
      enrollmentId: input.enrollmentId,
      ruleId: rule.id,
      kind: rule.kind,
      category: rule.category,
      ruleName: rule.name,
      points: rule.points,
      occurredOn: date,
      note: input.note || null,
      evidenceKey,
      evidenceType: input.evidence?.contentType ?? null,
      reversesEntryId: null,
      recordedBy: actor.userId,
    });
    if (rule.kind === 'violation') await raiseThresholdTasks(tx, actor.schoolId, input.enrollmentId, before, -rule.points);
    await audit(tx, auditCtx, 'ksw.point_recorded', { type: 'point_entry', id }, { after: { enrollmentId: input.enrollmentId, ruleId: rule.id, kind: rule.kind, points: rule.points, date, evidence: evidenceKey !== null } });
    const row = await findEntry(tx, id);
    if (!row) throw new Error('point entry vanished');
    return view(row);
  });
}

/**
 * POST /point-entries/{id}/reverse (admin, wakasek): adds an entry with the opposite points and the
 * reason as its note. An entry is reversed once (409 already_reversed; the table is insert-only, so there
 * is no row lock and the unique index on reverses_entry_id decides a race); a reversing entry cannot itself
 * be reversed (409 is_reversal).
 */
export function reversePointEntry(actor: Actor, auditCtx: AuditContext, today: string, entryId: string, input: ReversePointEntryRequest): Promise<PointEntry> {
  authorize(actor, canReversePoints);
  return withTenant(scope(actor), async (tx) => {
    const original = await findEntry(tx, entryId);
    if (!original) throw entryNotFound();
    if (original.reversesEntryId) throw new ConflictError('Catatan pembatalan tidak bisa dibatalkan lagi.', { reason: 'is_reversal' });
    if (original.reversed) throw new ConflictError('Catatan ini sudah dibatalkan.', { reason: 'already_reversed' });
    const id = uuidv7();
    try {
      await insertEntry(tx, {
        id,
        schoolId: actor.schoolId,
        enrollmentId: original.enrollmentId,
        ruleId: original.ruleId,
        kind: original.kind,
        category: original.category,
        ruleName: original.ruleName,
        points: -original.points,
        occurredOn: today,
        note: input.reason,
        evidenceKey: null,
        evidenceType: null,
        reversesEntryId: original.id,
        recordedBy: actor.userId,
      });
    } catch (err) {
      if (isUniqueViolation(err, REVERSED_KEY)) throw new ConflictError('Catatan ini sudah dibatalkan.', { reason: 'already_reversed' });
      throw err;
    }
    await audit(tx, auditCtx, 'ksw.point_reversed', { type: 'point_entry', id }, { after: { reverses: original.id, enrollmentId: original.enrollmentId, points: -original.points } });
    const row = await findEntry(tx, id);
    if (!row) throw new Error('point entry vanished');
    return view(row);
  });
}

/** GET /students/{enrollmentId}/points: net totals of the student's year plus the entries, newest first. */
export function studentPoints(actor: Actor, enrollmentId: string): Promise<StudentPoints> {
  return withTenant(scope(actor), async (tx) => {
    const student = await readableStudent(tx, actor, enrollmentId);
    const [totals, rows] = await Promise.all([totalsOf(tx, enrollmentId), entriesOf(tx, enrollmentId)]);
    return {
      student: { enrollmentId: student.enrollmentId, name: student.name, className: student.className },
      total: totals.violationPoints + totals.achievementPoints,
      ...totals,
      items: rows.map(view),
    };
  });
}

/** GET /point-entries/{id}/evidence: a 5-minute inline link for anyone who may read the student's profile. */
export async function pointEvidenceLink(actor: Actor, storage: ObjectStorage, entryId: string): Promise<PointEvidenceLink> {
  authorize(actor, canReadStudentPoints);
  const row = await withTenant(scope(actor), async (tx) => {
    const entry = await findEntry(tx, entryId);
    if (!entry) throw entryNotFound();
    await readableStudent(tx, actor, entry.enrollmentId);
    return entry;
  });
  if (!row.evidenceKey || !row.evidenceType) throw new NotFoundError('Catatan ini tanpa bukti.');
  const link = await storage.presignDownload({ key: row.evidenceKey, contentType: row.evidenceType });
  return { url: link.url, expiresAt: link.expiresAt.toISOString() };
}
