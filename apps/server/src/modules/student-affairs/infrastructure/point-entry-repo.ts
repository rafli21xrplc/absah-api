import { schema, sensitive, type Tx } from '@absah/db';
import type { PointKind } from '@absah/contracts';
import { asc, desc, eq, sql } from 'drizzle-orm';
import { directoryName } from '../../../shared/directory-name';

const p = schema.pointEntries;
const e = schema.enrollments;

/** The student behind an enrollment, with the class's wali kelas (who may read the profile). */
export async function findEnrollment(tx: Tx, enrollmentId: string) {
  const [row] = await tx
    .select({ enrollmentId: e.id, status: e.status, name: schema.students.name, className: schema.classes.name, homeroomTeacherId: schema.classes.homeroomTeacherId })
    .from(e)
    .innerJoin(schema.students, eq(schema.students.id, e.studentId))
    .innerJoin(schema.classes, eq(schema.classes.id, e.classId))
    .where(eq(e.id, enrollmentId));
  return row;
}

export interface NewEntry {
  id: string;
  schoolId: string;
  enrollmentId: string;
  ruleId: string;
  kind: PointKind;
  category: string;
  ruleName: string;
  points: number;
  occurredOn: string;
  note: string | null;
  evidenceKey: string | null;
  evidenceType: string | null;
  reversesEntryId: string | null;
  recordedBy: string;
}

export async function insertEntry(tx: Tx, row: NewEntry): Promise<void> {
  await tx.insert(p).values({ ...row, note: row.note === null ? null : sensitive(row.note) });
}

const recorder = directoryName(p.recordedBy);
// Qualified by hand: drizzle renders ${p.id} as a bare "id", which inside the subquery would bind to r.id.
const isReversed = sql<boolean>`exists (select 1 from point_entries r where r.reverses_entry_id = point_entries.id)`;

const columns = {
  id: p.id,
  enrollmentId: p.enrollmentId,
  ruleId: p.ruleId,
  kind: p.kind,
  category: p.category,
  ruleName: p.ruleName,
  points: p.points,
  occurredOn: p.occurredOn,
  note: p.note,
  evidenceKey: p.evidenceKey,
  evidenceType: p.evidenceType,
  reversesEntryId: p.reversesEntryId,
  recordedById: p.recordedBy,
  recordedByName: recorder,
  reversed: isReversed,
  createdAt: p.createdAt,
};

export async function findEntry(tx: Tx, id: string) {
  const [row] = await tx.select(columns).from(p).where(eq(p.id, id));
  return row;
}
export type EntryRow = NonNullable<Awaited<ReturnType<typeof findEntry>>>;

/** Newest first, at most 200: a school year of one student is far below that. */
export function entriesOf(tx: Tx, enrollmentId: string): Promise<EntryRow[]> {
  return tx.select(columns).from(p).where(eq(p.enrollmentId, enrollmentId)).orderBy(desc(p.occurredOn), desc(p.createdAt), desc(p.id)).limit(200);
}

/** Net points per kind; a reversing entry carries the kind of the one it cancels, so plain sums net out. */
export async function totalsOf(tx: Tx, enrollmentId: string): Promise<{ violationPoints: number; achievementPoints: number }> {
  const rows = await tx
    .select({ kind: p.kind, total: sql<number>`coalesce(sum(${p.points}), 0)::int` })
    .from(p)
    .where(eq(p.enrollmentId, enrollmentId))
    .groupBy(p.kind)
    .orderBy(asc(p.kind));
  const of = (kind: PointKind) => rows.find((r) => r.kind === kind)?.total ?? 0;
  return { violationPoints: of('violation'), achievementPoints: of('achievement') };
}
