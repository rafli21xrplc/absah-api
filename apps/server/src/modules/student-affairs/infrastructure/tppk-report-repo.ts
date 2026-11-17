import type { TppkReportCategory, TppkReporterRelation } from '@absah/contracts';
import { schema, sensitive, type Tx } from '@absah/db';
import { eq, sql } from 'drizzle-orm';

export async function schoolOf(tx: Tx, schoolId: string) {
  const s = schema.schools;
  const [row] = await tx.select({ name: s.name, level: s.level, isMadrasah: s.isMadrasah, timezone: s.timezone }).from(s).where(eq(s.id, schoolId));
  return row;
}

export interface NewReport {
  id: string;
  schoolId: string;
  category: TppkReportCategory;
  chronology: string;
  occurredOn: string | null;
  reporterRelation: TppkReporterRelation;
  isAnonymous: boolean;
  reporterUserId: string | null;
  reporterName: string | null;
  reporterContact: string | null;
  trackingCodeHash: string;
}

/** Plain INSERT: RETURNING would need SELECT, which only TPPK members have. */
export async function insertReport(tx: Tx, r: NewReport): Promise<void> {
  await tx.insert(schema.tppkReports).values({
    ...r,
    chronology: sensitive(r.chronology),
    reporterName: r.reporterName === null ? null : sensitive(r.reporterName),
    reporterContact: r.reporterContact === null ? null : sensitive(r.reporterContact),
  });
}

/** Through tppk.report_status: the status only, by keyed hash. */
export async function statusByCodeHash(tx: Tx, codeHash: string): Promise<string | null> {
  const res = await tx.execute<{ status: string | null }>(sql`select tppk.report_status(${codeHash}) as status`);
  return res.rows[0]?.status ?? null;
}
