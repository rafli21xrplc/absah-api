import {
  REQUIRED_SETUP_STEPS,
  SETUP_STEPS,
  type SchoolSetupResponse,
  type SetupStep,
  type UpdateSetupStepRequest,
} from '@absah/contracts';
import type { Tx } from '@absah/db';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { canManageSchoolSettings } from '../domain/policies';
import { lockSchoolProfile, readSetup, saveSetup } from '../infrastructure/school-settings-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });

async function view(tx: Tx, schoolId: string): Promise<SchoolSetupResponse> {
  const profile = await lockSchoolProfile(tx, schoolId);
  if (!profile) throw new NotFoundError('Sekolah tidak ditemukan.');
  const setup = await readSetup(tx, schoolId);
  return {
    steps: SETUP_STEPS.map((id) => ({ id, status: setup?.steps[id] ?? 'todo' })),
    completedAt: setup?.completedAt?.toISOString() ?? null,
    profile,
  };
}

/** Wizard progress (PLT-12). Steps change data through their own endpoints; this only tracks. */
export async function getSchoolSetup(actor: Actor): Promise<SchoolSetupResponse> {
  authorize(actor, canManageSchoolSettings);
  return withTenant(scope(actor), (tx) => view(tx, actor.schoolId));
}

export async function markSetupStep(
  actor: Actor,
  step: SetupStep,
  input: UpdateSetupStepRequest,
): Promise<SchoolSetupResponse> {
  authorize(actor, canManageSchoolSettings);
  if (input.status === 'skipped' && REQUIRED_SETUP_STEPS.includes(step)) {
    throw new ValidationError([{ path: 'status', message: 'Langkah ini wajib diisi.' }]);
  }
  return withTenant(scope(actor), async (tx) => {
    const setup = await readSetup(tx, actor.schoolId);
    await saveSetup(tx, actor.schoolId, { steps: { ...setup?.steps, [step]: input.status } });
    return view(tx, actor.schoolId);
  });
}

/** Finishes the wizard once the required steps are done. Finishing twice keeps the first time. */
export async function completeSchoolSetup(actor: Actor, auditCtx: AuditContext): Promise<SchoolSetupResponse> {
  authorize(actor, canManageSchoolSettings);
  return withTenant(scope(actor), async (tx) => {
    const setup = await readSetup(tx, actor.schoolId);
    const missing = REQUIRED_SETUP_STEPS.filter((s) => setup?.steps[s] !== 'done');
    if (missing.length > 0) throw new ConflictError('Lengkapi profil dan jenjang sekolah dulu.', { steps: missing });
    if (!setup?.completedAt) {
      await saveSetup(tx, actor.schoolId, { completedAt: new Date() });
      await audit(tx, auditCtx, 'school.setup_completed', { type: 'school', id: actor.schoolId });
    }
    return view(tx, actor.schoolId);
  });
}
