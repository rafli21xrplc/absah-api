import type { CreatePointThresholdRequest, PointThreshold, PointThresholdList, UpdatePointThresholdRequest } from '@absah/contracts';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError } from '../../../shared/errors';
import { isUniqueViolation } from '../../../shared/pg-errors';
import type { Actor } from '../../../shared/policy';
import { canManageThresholds, canReadThresholds } from '../domain/policies';
import { findThreshold, insertThreshold, listThresholds, updateThreshold } from '../infrastructure/followup-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const POINTS_KEY = 'point_thresholds_school_id_min_points_key';
const POINTS_TAKEN = 'Sudah ada tingkat dengan jumlah poin itu.';

export function listPointThresholds(actor: Actor, includeInactive: boolean): Promise<PointThresholdList> {
  authorize(actor, canReadThresholds);
  const all = includeInactive && canManageThresholds.allows(actor);
  return withTenant(scope(actor), async (tx) => ({ items: await listThresholds(tx, all) }));
}

export function createPointThreshold(actor: Actor, auditCtx: AuditContext, input: CreatePointThresholdRequest): Promise<PointThreshold> {
  authorize(actor, canManageThresholds);
  return withTenant(scope(actor), async (tx) => {
    const id = uuidv7();
    try {
      await insertThreshold(tx, { id, schoolId: actor.schoolId, ...input, createdBy: actor.userId });
    } catch (err) {
      if (isUniqueViolation(err, POINTS_KEY)) throw new ConflictError(POINTS_TAKEN);
      throw err;
    }
    await audit(tx, auditCtx, 'ksw.threshold_created', { type: 'point_threshold', id }, { after: input });
    const row = await findThreshold(tx, id);
    if (!row) throw new Error('threshold vanished');
    return row;
  });
}

/** Partial edit. A tier applies to entries recorded after the change; tasks already made keep their copy. */
export function updatePointThreshold(actor: Actor, auditCtx: AuditContext, id: string, input: UpdatePointThresholdRequest): Promise<PointThreshold> {
  authorize(actor, canManageThresholds);
  return withTenant(scope(actor), async (tx) => {
    const before = await findThreshold(tx, id);
    if (!before) throw new NotFoundError('Tingkat tidak ditemukan.');
    const changed = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    if (Object.keys(changed).length > 0) {
      try {
        await updateThreshold(tx, id, changed);
      } catch (err) {
        if (isUniqueViolation(err, POINTS_KEY)) throw new ConflictError(POINTS_TAKEN);
        throw err;
      }
      const beforeFields = Object.fromEntries(Object.keys(changed).map((k) => [k, before[k as keyof typeof before]]));
      await audit(tx, auditCtx, 'ksw.threshold_updated', { type: 'point_threshold', id }, { before: beforeFields, after: changed });
    }
    const row = await findThreshold(tx, id);
    if (!row) throw new Error('threshold vanished');
    return row;
  });
}
