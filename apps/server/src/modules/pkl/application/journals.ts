import {
  PKL_JOURNAL_MAX_BACKDATE_DAYS,
  type CreatePklAttachmentRequest,
  type CreatePklAttachmentResponse,
  type PklAttachmentLink,
  type PklJournal,
  type PklJournalList,
  type PklJournalQuery,
  type ReviewPklJournalRequest,
  type WritePklJournalRequest,
} from '@absah/contracts';
import type { Tx } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { addDays } from '../../../shared/school-date';
import { storageKey, type ObjectStorage } from '../../../shared/storage';
import { canCheckIn, canManagePkl, canSeeAllPkl } from '../domain/policies';
import { studentPlacementOn } from '../infrastructure/checkin-repo';
import { insertJournal, listJournals, lockJournal, lockJournalById, updateJournal, type JournalFilter, type JournalRow } from '../infrastructure/journal-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const notFound = () => new NotFoundError('Jurnal PKL tidak ditemukan.');

/** Who sees which journals: the student their own, leaders all, a supervisor their placements. */
function visibility(actor: Actor): JournalFilter {
  if (canCheckIn.allows(actor)) return { studentUserId: actor.userId };
  if (canSeeAllPkl.allows(actor)) return {};
  return { supervisorId: actor.userId };
}

/** The guru pembimbing or the industry supervisor of the placement, or a PKL manager. */
const mayReview = (actor: Actor, row: Pick<JournalRow, 'schoolMentorId' | 'industryMentorId'>) =>
  row.schoolMentorId === actor.userId || row.industryMentorId === actor.userId || canManagePkl.allows(actor);

function toJournal(actor: Actor, row: JournalRow): PklJournal {
  return {
    id: row.id,
    placementId: row.placementId,
    student: { name: row.studentName, className: row.className },
    partnerName: row.partnerName,
    date: row.date,
    activity: row.activity,
    competency: row.competency,
    attachmentType: row.attachmentType as PklJournal['attachmentType'],
    status: row.status,
    reviewNote: row.reviewNote,
    reviewer: row.reviewer,
    reviewedAt: row.reviewedAt?.toISOString() ?? null,
    canReview: mayReview(actor, row),
  };
}

async function visibleJournal(tx: Tx, actor: Actor, id: string): Promise<JournalRow> {
  const [row] = await listJournals(tx, { ...visibility(actor), id });
  if (!row) throw notFound();
  return row;
}

/** GET /pkl/journals: newest first, the last 31 days unless a range is given. */
export function listPklJournals(actor: Actor, today: string, query: PklJournalQuery): Promise<PklJournalList> {
  const from = query.from ?? (query.to ? addDays(query.to, -30) : addDays(today, -30));
  return withTenant(scope(actor), async (tx) => {
    const rows = await listJournals(tx, { ...visibility(actor), placementId: query.placementId, status: query.status, from, to: query.to });
    return { items: rows.map((r) => toJournal(actor, r)) };
  });
}

/** POST /pkl/journals/attachments (siswa): presigned PUT under schools/{id}/pkl/{uuid}. */
export async function createPklAttachment(actor: Actor, storage: ObjectStorage, input: CreatePklAttachmentRequest): Promise<CreatePklAttachmentResponse> {
  authorize(actor, canCheckIn);
  const attachmentId = uuidv7();
  const upload = await storage.presignUpload({ key: storageKey(actor.schoolId, 'pkl', attachmentId), contentType: input.contentType, contentLength: input.fileSize });
  return { attachmentId, upload: { ...upload, expiresAt: upload.expiresAt.toISOString() } };
}

/**
 * POST /pkl/journals (siswa): the journal of a date inside the running placement, today or up to
 * PKL_JOURNAL_MAX_BACKDATE_DAYS back. Rewriting is allowed until it is approved (409 approved); a
 * rewrite goes back to submitted. A replaced or removed file is deleted after the commit.
 */
export async function writePklJournal(actor: Actor, auditCtx: AuditContext, storage: ObjectStorage, today: string, input: WritePklJournalRequest, now = new Date()): Promise<PklJournal> {
  authorize(actor, canCheckIn);
  const date = input.date ?? today;
  if (date > today) throw new ValidationError([{ path: 'date', message: 'Tanggal tidak boleh di masa depan.' }]);
  if (date < addDays(today, -PKL_JOURNAL_MAX_BACKDATE_DAYS)) {
    throw new ValidationError([{ path: 'date', message: `Jurnal hanya bisa ditulis sampai ${PKL_JOURNAL_MAX_BACKDATE_DAYS} hari ke belakang.` }]);
  }
  const newKey = input.attachment ? storageKey(actor.schoolId, 'pkl', input.attachment.id) : null;
  if (newKey && !(await storage.read(newKey))) throw new ValidationError([{ path: 'attachment', message: 'Lampiran belum terunggah. Unggah ulang.' }]);

  const { journal, removed } = await withTenant(scope(actor), async (tx) => {
    const placement = await studentPlacementOn(tx, actor.userId, date);
    if (!placement) throw new ConflictError('Tidak ada PKL yang berjalan pada tanggal itu.', { reason: 'no_placement' });
    const existing = await lockJournal(tx, placement.placementId, date);
    const attachment =
      input.attachment === undefined
        ? { attachmentKey: existing?.attachmentKey ?? null, attachmentType: existing?.attachmentType ?? null }
        : { attachmentKey: newKey, attachmentType: input.attachment?.contentType ?? null };
    const values = { activity: input.activity, competency: input.competency ?? null, ...attachment, status: 'submitted' as const };
    let id: string;
    if (existing) {
      if (existing.status === 'approved') throw new ConflictError('Jurnal ini sudah disetujui.', { reason: 'approved' });
      id = existing.id;
      await updateJournal(tx, id, values);
    } else {
      id = uuidv7();
      await insertJournal(tx, { id, schoolId: actor.schoolId, placementId: placement.placementId, schoolDate: date, ...values, createdAt: now });
    }
    await audit(tx, auditCtx, existing ? 'pkl.journal_updated' : 'pkl.journal_written', { type: 'pkl_journal', id }, {
      before: existing ? { status: existing.status } : undefined,
      after: { date, status: 'submitted', attachment: attachment.attachmentKey !== null },
    });
    const removedKey = existing?.attachmentKey && existing.attachmentKey !== attachment.attachmentKey ? existing.attachmentKey : null;
    return { journal: toJournal(actor, await visibleJournal(tx, actor, id)), removed: removedKey };
  });
  if (removed) await storage.remove(removed).catch(() => undefined);
  return journal;
}

/** POST /pkl/journals/{id}/review: approve or ask for a revision (submitted only, else 409 not_submitted). */
export function reviewPklJournal(actor: Actor, auditCtx: AuditContext, id: string, input: ReviewPklJournalRequest, now = new Date()): Promise<PklJournal> {
  return withTenant(scope(actor), async (tx) => {
    const row = await visibleJournal(tx, actor, id);
    if (!mayReview(actor, row)) throw notFound();
    const locked = await lockJournalById(tx, id);
    if (!locked) throw notFound();
    if (locked.status !== 'submitted') throw new ConflictError('Jurnal ini sudah ditinjau.', { reason: 'not_submitted' });
    await updateJournal(tx, id, { status: input.decision, reviewNote: input.note ?? null, reviewedBy: actor.userId, reviewedAt: now });
    await audit(tx, auditCtx, 'pkl.journal_reviewed', { type: 'pkl_journal', id }, { before: { status: 'submitted' }, after: { status: input.decision } });
    return toJournal(actor, await visibleJournal(tx, actor, id));
  });
}

/** GET /pkl/journals/{id}/attachment: a 5-minute inline link for anyone who sees the journal. */
export async function pklAttachmentLink(actor: Actor, storage: ObjectStorage, id: string): Promise<PklAttachmentLink> {
  const row = await withTenant(scope(actor), (tx) => visibleJournal(tx, actor, id));
  if (!row.attachmentKey || !row.attachmentType) throw new NotFoundError('Jurnal ini tanpa lampiran.');
  const link = await storage.presignDownload({ key: row.attachmentKey, contentType: row.attachmentType });
  return { url: link.url, expiresAt: link.expiresAt.toISOString() };
}
