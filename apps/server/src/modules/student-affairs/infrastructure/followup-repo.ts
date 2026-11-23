import { schema, sensitive, type Tx } from '@absah/db';
import type { FollowupStatus } from '@absah/contracts';
import { and, asc, desc, eq, sql, type SQL } from 'drizzle-orm';
import { directoryName } from '../../../shared/directory-name';

const th = schema.pointThresholds;
const f = schema.followupTasks;
const e = schema.enrollments;

export type ThresholdRow = { id: string; minPoints: number; label: string; action: string; notifyParents: boolean; active: boolean };
const thresholdColumns = { id: th.id, minPoints: th.minPoints, label: th.label, action: th.action, notifyParents: th.notifyParents, active: th.active };

export function listThresholds(tx: Tx, includeInactive: boolean): Promise<ThresholdRow[]> {
  const query = tx.select(thresholdColumns).from(th);
  return (includeInactive ? query : query.where(eq(th.active, true))).orderBy(asc(th.minPoints));
}

export async function findThreshold(tx: Tx, id: string): Promise<ThresholdRow | undefined> {
  const [row] = await tx.select(thresholdColumns).from(th).where(eq(th.id, id));
  return row;
}

export function insertThreshold(tx: Tx, row: { id: string; schoolId: string; minPoints: number; label: string; action: string; notifyParents: boolean; createdBy: string }) {
  return tx.insert(th).values(row);
}

export function updateThreshold(tx: Tx, id: string, fields: { minPoints?: number; label?: string; action?: string; notifyParents?: boolean; active?: boolean }) {
  return tx.update(th).set({ ...fields, updatedAt: new Date() }).where(eq(th.id, id));
}

/**
 * Serialises point recording per student for the rest of the transaction. Without it two entries recorded
 * at once each see the total without the other and neither notices the tier they jointly cross.
 */
export async function lockStudentPoints(tx: Tx, enrollmentId: string): Promise<void> {
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${enrollmentId}, 0))`);
}

/** Makes the task of a tier for an enrollment; false when one already exists (made earlier, maybe done). */
export async function insertTaskOnce(tx: Tx, row: { id: string; schoolId: string; enrollmentId: string; thresholdId: string; label: string; action: string; minPoints: number; totalPoints: number }): Promise<boolean> {
  const inserted = await tx.insert(f).values(row).onConflictDoNothing().returning({ id: f.id });
  return inserted.length > 0;
}

const completer = directoryName(f.completedBy);

const taskColumns = {
  id: f.id,
  enrollmentId: f.enrollmentId,
  name: schema.students.name,
  className: schema.classes.name,
  homeroomTeacherId: schema.classes.homeroomTeacherId,
  label: f.label,
  action: f.action,
  minPoints: f.minPoints,
  totalPoints: f.totalPoints,
  status: f.status,
  createdAt: f.createdAt,
  completedAt: f.completedAt,
  completedById: f.completedBy,
  completedByName: completer,
  note: f.note,
};

function tasks(tx: Tx) {
  return tx
    .select(taskColumns)
    .from(f)
    .innerJoin(e, eq(e.id, f.enrollmentId))
    .innerJoin(schema.students, eq(schema.students.id, e.studentId))
    .innerJoin(schema.classes, eq(schema.classes.id, e.classId));
}

export type TaskRow = Awaited<ReturnType<typeof listTasks>>[number];

/** Newest first, at most 200; homeroomTeacherId limits the list to one wali kelas's class. */
export function listTasks(tx: Tx, filter: { status?: FollowupStatus; homeroomTeacherId?: string }) {
  const where: SQL[] = [];
  if (filter.status) where.push(eq(f.status, filter.status));
  if (filter.homeroomTeacherId) where.push(eq(schema.classes.homeroomTeacherId, filter.homeroomTeacherId));
  return tasks(tx)
    .where(and(...where))
    .orderBy(desc(f.createdAt), desc(f.id))
    .limit(200);
}

export async function findTask(tx: Tx, id: string): Promise<TaskRow | undefined> {
  const [row] = await tasks(tx).where(eq(f.id, id));
  return row;
}

/** Closes an open task; false when it was already done (or gone), so two people finishing it at once cannot both win. */
export async function completeTask(tx: Tx, id: string, by: string, note: string | null, at: Date): Promise<boolean> {
  const done = await tx
    .update(f)
    .set({ status: 'done', completedAt: at, completedBy: by, note: note === null ? null : sensitive(note) })
    .where(and(eq(f.id, id), eq(f.status, 'open')))
    .returning({ id: f.id });
  return done.length > 0;
}
