import type { TppkCaseStatus, TppkEventKind, TppkReportStatus } from '@absah/contracts';
import { schema, sensitive, type Tx } from '@absah/db';
import { asc, desc, eq, type AnyColumn } from 'drizzle-orm';
import { directoryName } from '../../../shared/directory-name';

const r = schema.tppkReports;
const c = schema.tppkCases;
const ev = schema.tppkCaseEvents;
const nameOf = (column: AnyColumn) => directoryName(column);

// Reads below run under the members-only policies: a non-member gets nothing, whatever the code does.

const reportColumns = {
  id: r.id,
  category: r.category,
  status: r.status,
  receivedAt: r.createdAt,
  occurredOn: r.occurredOn,
  reporterRelation: r.reporterRelation,
  isAnonymous: r.isAnonymous,
  caseId: c.id,
};

export function listReports(tx: Tx, status: TppkReportStatus | undefined) {
  const q = tx.select(reportColumns).from(r).leftJoin(c, eq(c.reportId, r.id));
  return (status ? q.where(eq(r.status, status)) : q).orderBy(desc(r.createdAt), desc(r.id));
}

export async function findReport(tx: Tx, id: string) {
  const [row] = await tx
    .select({
      ...reportColumns,
      chronology: r.chronology,
      reporterName: r.reporterName,
      reporterContact: r.reporterContact,
      reporterUserId: r.reporterUserId,
      reporterAccountName: nameOf(r.reporterUserId),
    })
    .from(r)
    .leftJoin(c, eq(c.reportId, r.id))
    .where(eq(r.id, id));
  return row;
}
export type ReportRow = NonNullable<Awaited<ReturnType<typeof findReport>>>;

export const setReportStatus = (tx: Tx, id: string, status: TppkReportStatus) => tx.update(r).set({ status, updatedAt: new Date() }).where(eq(r.id, id));

const caseColumns = {
  id: c.id,
  reportId: c.reportId,
  category: r.category,
  summary: c.summary,
  status: c.status,
  openedAt: c.createdAt,
  openedById: c.openedBy,
  openedByName: nameOf(c.openedBy),
  closedAt: c.closedAt,
};

export function listCases(tx: Tx, status: TppkCaseStatus | undefined) {
  const q = tx.select(caseColumns).from(c).leftJoin(r, eq(r.id, c.reportId));
  return (status ? q.where(eq(c.status, status)) : q).orderBy(desc(c.createdAt), desc(c.id));
}

export async function findCase(tx: Tx, id: string) {
  const [row] = await tx.select(caseColumns).from(c).leftJoin(r, eq(r.id, c.reportId)).where(eq(c.id, id));
  return row;
}
export type CaseRow = NonNullable<Awaited<ReturnType<typeof findCase>>>;

export async function caseOfReport(tx: Tx, reportId: string): Promise<string | null> {
  const [row] = await tx.select({ id: c.id }).from(c).where(eq(c.reportId, reportId));
  return row?.id ?? null;
}

export async function insertCase(tx: Tx, row: { id: string; schoolId: string; reportId: string | null; summary: string; openedBy: string }): Promise<void> {
  await tx.insert(c).values({ ...row, summary: sensitive(row.summary) });
}

export const setCaseStatus = (tx: Tx, id: string, status: TppkCaseStatus, by: string, at: Date) =>
  tx
    .update(c)
    .set(status === 'closed' ? { status, closedAt: at, closedBy: by, updatedAt: at } : { status, closedAt: null, closedBy: null, updatedAt: at })
    .where(eq(c.id, id));

export async function insertEvent(tx: Tx, row: { schoolId: string; caseId: string; kind: TppkEventKind; note: string; createdBy: string }): Promise<void> {
  await tx.insert(ev).values({ ...row, note: sensitive(row.note) });
}

export const eventsOf = (tx: Tx, caseId: string) =>
  tx
    .select({ id: ev.id, kind: ev.kind, note: ev.note, createdAt: ev.createdAt, createdById: ev.createdBy, createdByName: nameOf(ev.createdBy) })
    .from(ev)
    .where(eq(ev.caseId, caseId))
    .orderBy(asc(ev.createdAt), asc(ev.id));
export type EventRow = Awaited<ReturnType<typeof eventsOf>>[number];
