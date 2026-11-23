import type { CreateFeeTypeRequest, FeeType, FeeTypeList, UpdateFeeTypeRequest } from '@absah/contracts';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError } from '../../../shared/errors';
import { isUniqueViolation } from '../../../shared/pg-errors';
import type { Actor } from '../../../shared/policy';
import { canManageBilling, canReadStudentBills } from '../domain/policies';
import { findFeeType, insertFeeType, listFeeTypes, updateFeeType } from '../infrastructure/fee-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const NAME_TAKEN = 'Nama jenis tagihan sudah dipakai.';
const NAME_KEY = 'fee_types_school_id_name_key';
/** The audit sanitiser redacts any key called "name" (personal data); a fee's title is not, so it is logged as "fee". */
const forAudit = (fields: Record<string, unknown>) => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k === 'name' ? 'fee' : k, v]));

export function listFeeTypesFor(actor: Actor, includeInactive: boolean): Promise<FeeTypeList> {
  authorize(actor, canReadStudentBills);
  return withTenant(scope(actor), async (tx) => ({ items: await listFeeTypes(tx, includeInactive) }));
}

export function createFeeType(actor: Actor, auditCtx: AuditContext, input: CreateFeeTypeRequest): Promise<FeeType> {
  authorize(actor, canManageBilling);
  return withTenant(scope(actor), async (tx) => {
    const id = uuidv7();
    try {
      await insertFeeType(tx, { id, schoolId: actor.schoolId, ...input, createdBy: actor.userId });
    } catch (err) {
      if (isUniqueViolation(err, NAME_KEY)) throw new ConflictError(NAME_TAKEN, { reason: 'name_taken' });
      throw err;
    }
    await audit(tx, auditCtx, 'billing.fee_type_created', { type: 'fee_type', id }, { after: forAudit(input) });
    const row = await findFeeType(tx, id);
    if (!row) throw new Error('fee type vanished');
    return row;
  });
}

/** Partial edit. A new amount only applies to bills issued afterwards; switching a fee off keeps it for the bills that cite it. */
export function updateFeeTypeFor(actor: Actor, auditCtx: AuditContext, id: string, input: UpdateFeeTypeRequest): Promise<FeeType> {
  authorize(actor, canManageBilling);
  return withTenant(scope(actor), async (tx) => {
    const before = await findFeeType(tx, id);
    if (!before) throw new NotFoundError('Jenis tagihan tidak ditemukan.');
    const changed = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    if (Object.keys(changed).length > 0) {
      try {
        await updateFeeType(tx, id, changed);
      } catch (err) {
        if (isUniqueViolation(err, NAME_KEY)) throw new ConflictError(NAME_TAKEN, { reason: 'name_taken' });
        throw err;
      }
      const beforeFields = Object.fromEntries(Object.keys(changed).map((k) => [k, before[k as keyof typeof before]]));
      await audit(tx, auditCtx, 'billing.fee_type_updated', { type: 'fee_type', id }, { before: forAudit(beforeFields), after: forAudit(changed) });
    }
    const row = await findFeeType(tx, id);
    if (!row) throw new Error('fee type vanished');
    return row;
  });
}
