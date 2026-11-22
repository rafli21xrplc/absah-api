import type { CompleteFollowupRequest, FollowupStatus, FollowupTask, FollowupTaskList } from '@absah/contracts';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError } from '../../../shared/errors';
import { emit } from '../../../shared/outbox';
import type { Actor } from '../../../shared/policy';
import { canFollowUp, canReadFollowups, canSeeAllFollowups } from '../domain/policies';
import { crossedThresholds } from '../domain/thresholds';
import { completeTask, findTask, insertTaskOnce, listTasks, listThresholds, type TaskRow } from '../infrastructure/followup-repo';
import { uuidv7 } from 'uuidv7';
import type { Tx } from '@absah/db';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const notFound = () => new NotFoundError('Tugas tindak lanjut tidak ditemukan.');

/** The note is decrypted only here, for the roles that may see the task. */
function view(r: TaskRow): FollowupTask {
  return {
    id: r.id,
    student: { enrollmentId: r.enrollmentId, name: r.name, className: r.className },
    label: r.label,
    action: r.action,
    minPoints: r.minPoints,
    totalPoints: r.totalPoints,
    status: r.status,
    createdAt: r.createdAt.toISOString(),
    completedAt: r.completedAt?.toISOString() ?? null,
    completedBy: r.completedById ? { id: r.completedById, name: r.completedByName ?? '' } : null,
    note: r.note?.reveal() ?? null,
  };
}

/** Leaders and BK see every task; a wali kelas the tasks of the class they lead. */
const mayHandle = (actor: Actor, r: Pick<TaskRow, 'homeroomTeacherId'>) => canSeeAllFollowups.allows(actor) || r.homeroomTeacherId === actor.userId;

/**
 * Called right after a pelanggaran is stored, inside the same transaction. Takes the per-student lock first
 * (so the "before" total cannot miss a concurrent entry), then makes one task for each active tier the new
 * points crossed and emits ksw.threshold_reached for it. Tiers added later are not applied backwards.
 */
export async function raiseThresholdTasks(tx: Tx, schoolId: string, enrollmentId: string, before: number, added: number): Promise<number> {
  const tiers = await listThresholds(tx, false);
  const crossed = crossedThresholds(before, before + added, tiers);
  let made = 0;
  for (const tier of crossed) {
    const id = uuidv7();
    const inserted = await insertTaskOnce(tx, { id, schoolId, enrollmentId, thresholdId: tier.id, label: tier.label, action: tier.action, minPoints: tier.minPoints, totalPoints: before + added });
    if (!inserted) continue;
    made += 1;
    await emit(tx, 'ksw.threshold_reached', { taskId: id });
  }
  return made;
}

/** GET /followup-tasks: newest first. */
export function listFollowups(actor: Actor, status: FollowupStatus | undefined): Promise<FollowupTaskList> {
  authorize(actor, canReadFollowups);
  return withTenant(scope(actor), async (tx) => {
    const rows = await listTasks(tx, { status, homeroomTeacherId: canSeeAllFollowups.allows(actor) ? undefined : actor.userId });
    return { items: rows.map(view) };
  });
}

/** POST /followup-tasks/{id}/complete: open to done once (409 already_done). The note and who closed it are kept. */
export function completeFollowup(actor: Actor, auditCtx: AuditContext, id: string, input: CompleteFollowupRequest, now = new Date()): Promise<FollowupTask> {
  authorize(actor, canFollowUp);
  return withTenant(scope(actor), async (tx) => {
    const task = await findTask(tx, id);
    if (!task || !mayHandle(actor, task)) throw notFound();
    if (!(await completeTask(tx, id, actor.userId, input.note || null, now))) throw new ConflictError('Tugas ini sudah selesai.', { reason: 'already_done' });
    await audit(tx, auditCtx, 'ksw.followup_completed', { type: 'followup_task', id }, { before: { status: 'open' }, after: { status: 'done' } });
    const row = await findTask(tx, id);
    if (!row) throw new Error('followup task vanished');
    return view(row);
  });
}
