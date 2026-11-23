import type { PklAssessmentAspectList, SavePklAspectsRequest } from '@absah/contracts';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, ValidationError } from '../../../shared/errors';
import { isUniqueViolation } from '../../../shared/pg-errors';
import type { Actor } from '../../../shared/policy';
import { planAspects, type AspectProblem } from '../domain/assessment-aspects';
import { canManagePkl, canReadPklAssessment } from '../domain/policies';
import { activeAspects, applyAspectPlan } from '../infrastructure/assessment-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });

const MESSAGES: Record<AspectProblem['kind'], (p: AspectProblem) => string> = {
  unknown_id: () => 'Ada aspek yang tidak dikenal. Muat ulang daftar aspek.',
  duplicate_id: () => 'Satu aspek muncul dua kali.',
  duplicate_name: (p) => `Nama aspek "${'name' in p ? p.name : ''}" dipakai dua kali.`,
  too_many: () => 'Terlalu banyak aspek.',
};

const view = (rows: Awaited<ReturnType<typeof activeAspects>>): PklAssessmentAspectList => ({ items: rows.map(({ position: _position, ...r }) => r) });

/** GET /pkl/assessment-aspects (PKL-04). */
export function listAspects(actor: Actor): Promise<PklAssessmentAspectList> {
  authorize(actor, canReadPklAssessment);
  return withTenant(scope(actor), async (tx) => view(await activeAspects(tx)));
}

/** PUT /pkl/assessment-aspects: the whole list in form order (managers). */
export function saveAspects(actor: Actor, auditCtx: AuditContext, input: SavePklAspectsRequest): Promise<PklAssessmentAspectList> {
  authorize(actor, canManagePkl);
  return withTenant(scope(actor), async (tx) => {
    const before = await activeAspects(tx);
    const { plan, problems } = planAspects(before, input.items);
    if (!plan) throw new ValidationError(problems.map((p) => ({ path: 'items', message: MESSAGES[p.kind](p) })));
    try {
      await applyAspectPlan(tx, actor.schoolId, plan, plan.insert.map(() => uuidv7()));
    } catch (err) {
      if (isUniqueViolation(err, 'pkl_assessment_aspects_school_id_name_key')) throw new ConflictError('Nama aspek sudah dipakai.');
      throw err;
    }
    const after = await activeAspects(tx);
    await audit(tx, auditCtx, 'pkl.assessment_aspects_saved', { type: 'school', id: actor.schoolId }, { before: { aspects: before.map((r) => r.name) }, after: { aspects: after.map((r) => r.name), retired: plan.retire.length } });
    return view(after);
  });
}
