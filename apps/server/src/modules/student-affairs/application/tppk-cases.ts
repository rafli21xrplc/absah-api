import type {
  AddTppkCaseEventRequest,
  CreateTppkCaseRequest,
  TppkCaseDetail,
  TppkCaseList,
  TppkCaseNoteRequest,
  TppkCaseStatus,
  TppkCaseSummary,
  TppkReportDetail,
  TppkReportList,
  TppkReportStatus,
  TppkReportSummary,
} from '@absah/contracts';
import type { Tx } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { withTenant } from '../../../shared/db';
import { ConflictError, ForbiddenError, NotFoundError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { isMember } from '../infrastructure/tppk-members-repo';
import {
  caseOfReport,
  eventsOf,
  findCase,
  findReport,
  insertCase,
  insertEvent,
  listCases,
  listReports,
  setCaseStatus,
  setReportStatus,
  type CaseRow,
  type EventRow,
  type ReportRow,
} from '../infrastructure/tppk-case-repo';

/**
 * KSW-07: the TPPK handles reports as cases. Only members get here (RLS would show a non-member
 * nothing anyway; the explicit check gives a clear 403). Every read and every change writes an
 * audit entry with ids and statuses only, never the chronology or a note.
 */
function asMember<T>(actor: Actor, auditCtx: AuditContext, fn: (tx: Tx, log: (action: string, entity: { type: string; id?: string }, after?: object) => Promise<void>) => Promise<T>): Promise<T> {
  return withTenant({ schoolId: actor.schoolId, userId: actor.userId }, async (tx) => {
    if (!(await isMember(tx, actor.userId))) throw new ForbiddenError('Hanya anggota TPPK sekolah ini yang dapat membuka laporan dan kasus.');
    return fn(tx, (action, entity, after) => audit(tx, auditCtx, action, entity, after ? { after } : {}));
  });
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

function reportSummary(r: ReportRow | Awaited<ReturnType<typeof listReports>>[number]): TppkReportSummary {
  return {
    id: r.id,
    category: r.category,
    status: r.status,
    receivedAt: r.receivedAt.toISOString(),
    occurredOn: r.occurredOn,
    reporterRelation: r.reporterRelation,
    isAnonymous: r.isAnonymous,
    caseId: r.caseId,
  };
}

/** Decrypted only here, for a member. */
function reportDetail(r: ReportRow): TppkReportDetail {
  return {
    ...reportSummary(r),
    chronology: r.chronology.reveal(),
    reporter: r.isAnonymous
      ? null
      : {
          name: r.reporterName?.reveal() ?? null,
          contact: r.reporterContact?.reveal() ?? null,
          account: r.reporterUserId ? { id: r.reporterUserId, name: r.reporterAccountName ?? '' } : null,
        },
  };
}

function caseSummary(c: CaseRow): TppkCaseSummary {
  return {
    id: c.id,
    reportId: c.reportId,
    category: c.category,
    summary: c.summary.reveal(),
    status: c.status,
    openedAt: c.openedAt.toISOString(),
    openedBy: c.openedById ? { id: c.openedById, name: c.openedByName ?? '' } : null,
    closedAt: iso(c.closedAt),
  };
}

const eventView = (e: EventRow) => ({
  id: e.id,
  kind: e.kind,
  note: e.note.reveal(),
  createdAt: e.createdAt.toISOString(),
  createdBy: e.createdById ? { id: e.createdById, name: e.createdByName ?? '' } : null,
});

async function caseDetail(tx: Tx, id: string): Promise<TppkCaseDetail> {
  const c = await findCase(tx, id);
  if (!c) throw new NotFoundError('Kasus tidak ditemukan.');
  const report = c.reportId ? await findReport(tx, c.reportId) : undefined;
  return { ...caseSummary(c), report: report ? reportDetail(report) : null, events: (await eventsOf(tx, id)).map(eventView) };
}

export function reportsForTeam(actor: Actor, auditCtx: AuditContext, status: TppkReportStatus | undefined): Promise<TppkReportList> {
  return asMember(actor, auditCtx, async (tx, log) => {
    const items = (await listReports(tx, status)).map(reportSummary);
    await log('tppk.reports_listed', { type: 'tppk_report' }, { status: status ?? null, count: items.length });
    return { items };
  });
}

export function reportForTeam(actor: Actor, auditCtx: AuditContext, id: string): Promise<TppkReportDetail> {
  return asMember(actor, auditCtx, async (tx, log) => {
    const report = await findReport(tx, id);
    if (!report) throw new NotFoundError('Laporan tidak ditemukan.');
    await log('tppk.report_viewed', { type: 'tppk_report', id });
    return reportDetail(report);
  });
}

export function casesForTeam(actor: Actor, auditCtx: AuditContext, status: TppkCaseStatus | undefined): Promise<TppkCaseList> {
  return asMember(actor, auditCtx, async (tx, log) => {
    const rows = await listCases(tx, status);
    await log('tppk.cases_listed', { type: 'tppk_case' }, { status: status ?? null, count: rows.length });
    return { items: rows.map(caseSummary) };
  });
}

export function caseForTeam(actor: Actor, auditCtx: AuditContext, id: string): Promise<TppkCaseDetail> {
  return asMember(actor, auditCtx, async (tx, log) => {
    const detail = await caseDetail(tx, id);
    await log('tppk.case_viewed', { type: 'tppk_case', id });
    return detail;
  });
}

/** Opens a case. From a report: one case per report, and the reporter's status becomes "ditangani". */
export function openCase(actor: Actor, auditCtx: AuditContext, input: CreateTppkCaseRequest): Promise<TppkCaseDetail> {
  return asMember(actor, auditCtx, async (tx, log) => {
    if (input.reportId) {
      const report = await findReport(tx, input.reportId);
      if (!report) throw new NotFoundError('Laporan tidak ditemukan.');
      if (await caseOfReport(tx, input.reportId)) throw new ConflictError('Laporan ini sudah punya kasus.');
      await setReportStatus(tx, input.reportId, 'ditangani');
    }
    const id = uuidv7();
    await insertCase(tx, { id, schoolId: actor.schoolId, reportId: input.reportId ?? null, summary: input.summary, openedBy: actor.userId });
    await log('tppk.case_opened', { type: 'tppk_case', id }, { reportId: input.reportId ?? null });
    return caseDetail(tx, id);
  });
}

async function openCaseRow(tx: Tx, id: string): Promise<CaseRow> {
  const c = await findCase(tx, id);
  if (!c) throw new NotFoundError('Kasus tidak ditemukan.');
  return c;
}

export function addCaseEvent(actor: Actor, auditCtx: AuditContext, caseId: string, input: AddTppkCaseEventRequest): Promise<TppkCaseDetail> {
  return asMember(actor, auditCtx, async (tx, log) => {
    const c = await openCaseRow(tx, caseId);
    if (c.status === 'closed') throw new ConflictError('Kasus sudah ditutup. Buka kembali untuk menambah catatan.');
    await insertEvent(tx, { schoolId: actor.schoolId, caseId, kind: input.kind, note: input.note, createdBy: actor.userId });
    await log('tppk.case_event_added', { type: 'tppk_case', id: caseId }, { kind: input.kind });
    return caseDetail(tx, caseId);
  });
}

/** Closing and reopening are events too, so the record of handling stays complete. */
function moveCase(target: TppkCaseStatus) {
  return (actor: Actor, auditCtx: AuditContext, caseId: string, input: TppkCaseNoteRequest, now = new Date()): Promise<TppkCaseDetail> =>
    asMember(actor, auditCtx, async (tx, log) => {
      const c = await openCaseRow(tx, caseId);
      if (c.status === target) throw new ConflictError(target === 'closed' ? 'Kasus sudah ditutup.' : 'Kasus masih terbuka.');
      await setCaseStatus(tx, caseId, target, actor.userId, now);
      await insertEvent(tx, { schoolId: actor.schoolId, caseId, kind: target === 'closed' ? 'ditutup' : 'dibuka_kembali', note: input.note, createdBy: actor.userId });
      if (c.reportId) await setReportStatus(tx, c.reportId, target === 'closed' ? 'selesai' : 'ditangani');
      await log(target === 'closed' ? 'tppk.case_closed' : 'tppk.case_reopened', { type: 'tppk_case', id: caseId });
      return caseDetail(tx, caseId);
    });
}

export const closeCase = moveCase('closed');
export const reopenCase = moveCase('open');
