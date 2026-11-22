import type { CounselingNote, CounselingNoteList, CounselingNotesQuery, CreateCounselingNoteRequest } from '@absah/contracts';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { canReadCounseling, canWriteCounseling } from '../domain/policies';
import { activeStudent, completeFollowUp, findNote, insertNote, listNotes, type NoteRow } from '../infrastructure/counseling-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });

/** The note is decrypted only here, for the guru BK and admin the policy already let through. */
function view(r: NoteRow): CounselingNote {
  return {
    id: r.id,
    student: { enrollmentId: r.enrollmentId, name: r.name, className: r.className },
    date: r.sessionDate,
    note: r.note.reveal(),
    followUp: r.followUp,
    followUpOn: r.followUpOn,
    followedUpAt: r.followedUpAt?.toISOString() ?? null,
    recordedBy: r.recordedById ? { id: r.recordedById, name: r.recordedByName ?? '' } : null,
  };
}

/**
 * POST /counseling-notes (guru BK): a note about an active student. The audit entry keeps who and what kind of
 * follow-up, never the note.
 */
export function recordCounselingNote(actor: Actor, auditCtx: AuditContext, today: string, input: CreateCounselingNoteRequest): Promise<CounselingNote> {
  authorize(actor, canWriteCounseling);
  const date = input.date ?? today;
  if (date > today) throw new ValidationError([{ path: 'date', message: 'Tanggal tidak boleh di masa depan.' }]);
  if (input.followUpOn && input.followUpOn < date) throw new ValidationError([{ path: 'followUpOn', message: 'Tanggal tindak lanjut tidak boleh sebelum tanggal sesi.' }]);
  return withTenant(scope(actor), async (tx) => {
    if (!(await activeStudent(tx, input.enrollmentId))) throw new NotFoundError('Siswa tidak ditemukan.');
    const id = uuidv7();
    await insertNote(tx, { id, schoolId: actor.schoolId, enrollmentId: input.enrollmentId, sessionDate: date, note: input.note, followUp: input.followUp, followUpOn: input.followUpOn ?? null, recordedBy: actor.userId });
    await audit(tx, auditCtx, 'ksw.counseling_recorded', { type: 'counseling_note', id }, { after: { enrollmentId: input.enrollmentId, followUp: input.followUp } });
    const row = await findNote(tx, id);
    if (!row) throw new Error('counseling note vanished');
    return view(row);
  });
}

/** GET /counseling-notes (guru BK, admin). Reading is audited: who looked at whose notes, without the notes. */
export function listCounselingNotes(actor: Actor, auditCtx: AuditContext, query: CounselingNotesQuery): Promise<CounselingNoteList> {
  authorize(actor, canReadCounseling);
  return withTenant(scope(actor), async (tx) => {
    const rows = await listNotes(tx, query);
    await audit(tx, auditCtx, 'ksw.counseling_read', { type: 'counseling_note', id: query.enrollmentId }, { after: { enrollmentId: query.enrollmentId ?? null, followUp: query.followUp ?? null, count: rows.length } });
    return { items: rows.map(view) };
  });
}

/** POST /counseling-notes/{id}/complete (guru BK): planned to done once (409 not_planned). The note itself never changes. */
export function completeCounselingFollowUp(actor: Actor, auditCtx: AuditContext, id: string, now = new Date()): Promise<CounselingNote> {
  authorize(actor, canWriteCounseling);
  return withTenant(scope(actor), async (tx) => {
    const note = await findNote(tx, id);
    if (!note) throw new NotFoundError('Catatan BK tidak ditemukan.');
    if (!(await completeFollowUp(tx, id, now))) throw new ConflictError('Tindak lanjut ini tidak sedang direncanakan.', { reason: 'not_planned' });
    await audit(tx, auditCtx, 'ksw.counseling_followup_done', { type: 'counseling_note', id }, { before: { followUp: 'planned' }, after: { followUp: 'done' } });
    const row = await findNote(tx, id);
    if (!row) throw new Error('counseling note vanished');
    return view(row);
  });
}
