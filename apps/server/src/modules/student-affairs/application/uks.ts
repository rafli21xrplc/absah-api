import type { CreateUksVisitRequest, UksStudentList, UksVisit, UksVisitList } from '@absah/contracts';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { withTenant } from '../../../shared/db';
import { ForbiddenError, NotFoundError } from '../../../shared/errors';
import { emit } from '../../../shared/outbox';
import type { Actor } from '../../../shared/policy';
import { schoolDate } from '../../../shared/school-date';
import { canUseUks } from '../domain/policies';
import { activeStudent, findVisit, insertVisit, searchStudents, visitsOfDay, type VisitRow } from '../infrastructure/uks-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });

function authorize(actor: Actor): void {
  if (!canUseUks.allows(actor)) throw new ForbiddenError('UKS dicatat oleh petugas UKS.');
}

/** The notes are decrypted only here, for the petugas who may read them. */
function view(r: VisitRow): UksVisit {
  return {
    id: r.id,
    schoolDate: r.schoolDate,
    visitedAt: r.visitedAt.toISOString(),
    student: { enrollmentId: r.enrollmentId, name: r.name, className: r.className },
    complaint: r.complaint.reveal(),
    action: r.action?.reveal() ?? null,
    outcome: r.outcome,
    recordedBy: r.recordedById ? { id: r.recordedById, name: r.recordedByName ?? '' } : null,
  };
}

export function findStudents(actor: Actor, text: string): Promise<UksStudentList> {
  authorize(actor);
  return withTenant(scope(actor), async (tx) => ({ items: await searchStudents(tx, text) }));
}

/**
 * Records a visit. Outcome dipulangkan emits uks.sent_home in the same transaction: attendance then
 * marks the rest of the day S (source uks) and notify tells the parents. The audit entry keeps
 * the outcome, never the notes.
 */
export function recordVisit(actor: Actor, auditCtx: AuditContext, timezone: string, input: CreateUksVisitRequest): Promise<UksVisit> {
  authorize(actor);
  return withTenant(scope(actor), async (tx) => {
    if (!(await activeStudent(tx, input.enrollmentId))) throw new NotFoundError('Siswa tidak ditemukan.');
    const id = uuidv7();
    await insertVisit(tx, {
      id,
      schoolId: actor.schoolId,
      enrollmentId: input.enrollmentId,
      schoolDate: schoolDate(timezone),
      complaint: input.complaint,
      action: input.action || null,
      outcome: input.outcome,
      recordedBy: actor.userId,
    });
    await audit(tx, auditCtx, 'uks.visit_recorded', { type: 'uks_visit', id }, { after: { enrollmentId: input.enrollmentId, outcome: input.outcome } });
    if (input.outcome === 'dipulangkan') await emit(tx, 'uks.sent_home', { uksVisitId: id });
    const row = await findVisit(tx, id);
    if (!row) throw new Error('uks visit vanished');
    return view(row);
  });
}

export function listVisits(actor: Actor, timezone: string, date: string | undefined): Promise<UksVisitList> {
  authorize(actor);
  const day = date ?? schoolDate(timezone);
  return withTenant(scope(actor), async (tx) => ({ schoolDate: day, items: (await visitsOfDay(tx, day)).map(view) }));
}
