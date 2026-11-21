import { pointsMatchKind, type CreatePointRuleRequest, type PointRule, type PointRuleList, type UpdatePointRuleRequest } from '@absah/contracts';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import { isUniqueViolation } from '../../../shared/pg-errors';
import type { Actor } from '../../../shared/policy';
import { canManagePointRules, canReadPointRules } from '../domain/policies';
import { findRule, insertRule, listRules, updateRule } from '../infrastructure/point-rule-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const NAME_TAKEN = 'Nama aturan sudah dipakai.';
const NAME_KEY = 'point_rules_school_id_name_key';

/** The audit sanitiser redacts any key called "name" (personal data); a rule's title is not, so it is logged as "rule". */
const forAudit = (fields: Record<string, unknown>) => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k === 'name' ? 'rule' : k, v]));

export function listPointRules(actor: Actor, includeInactive: boolean): Promise<PointRuleList> {
  authorize(actor, canReadPointRules);
  // Switched-off rules are for the managers' screen; a teacher recording an entry only needs the live ones.
  const all = includeInactive && canManagePointRules.allows(actor);
  return withTenant(scope(actor), async (tx) => ({ items: await listRules(tx, all) }));
}

export function createPointRule(actor: Actor, auditCtx: AuditContext, input: CreatePointRuleRequest): Promise<PointRule> {
  authorize(actor, canManagePointRules);
  return withTenant(scope(actor), async (tx) => {
    const id = uuidv7();
    try {
      await insertRule(tx, { id, schoolId: actor.schoolId, ...input, createdBy: actor.userId });
    } catch (err) {
      if (isUniqueViolation(err, NAME_KEY)) throw new ConflictError(NAME_TAKEN);
      throw err;
    }
    await audit(tx, auditCtx, 'ksw.point_rule_created', { type: 'point_rule', id }, { after: forAudit(input) });
    const row = await findRule(tx, id);
    if (!row) throw new Error('point rule vanished');
    return row;
  });
}

/** Partial edit. Points keep the sign of the kind; switching a rule off keeps it for the entries that cite it. */
export function updatePointRule(actor: Actor, auditCtx: AuditContext, id: string, input: UpdatePointRuleRequest): Promise<PointRule> {
  authorize(actor, canManagePointRules);
  return withTenant(scope(actor), async (tx) => {
    const before = await findRule(tx, id);
    if (!before) throw new NotFoundError('Aturan tidak ditemukan.');
    if (input.points !== undefined && !pointsMatchKind(before.kind, input.points)) {
      throw new ValidationError([{ path: 'points', message: 'Pelanggaran bernilai negatif, prestasi positif.' }]);
    }
    const changed = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    if (Object.keys(changed).length > 0) {
      try {
        await updateRule(tx, id, changed);
      } catch (err) {
        if (isUniqueViolation(err, NAME_KEY)) throw new ConflictError(NAME_TAKEN);
        throw err;
      }
      const beforeFields = Object.fromEntries(Object.keys(changed).map((k) => [k, before[k as keyof typeof before]]));
      await audit(tx, auditCtx, 'ksw.point_rule_updated', { type: 'point_rule', id }, { before: forAudit(beforeFields), after: forAudit(changed) });
    }
    const row = await findRule(tx, id);
    if (!row) throw new Error('point rule vanished');
    return row;
  });
}
