import type { CreateDudiPartnerRequest, DudiPartner, DudiPartnerList, PklStaffList, PklStudentList, UpdateDudiPartnerRequest } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError } from '../../../shared/errors';
import { isUniqueViolation } from '../../../shared/pg-errors';
import { authorize } from '../../../shared/authorize';
import type { Actor } from '../../../shared/policy';
import { canManagePkl, canSeeAllPkl } from '../domain/policies';
import { activeStaff, activeYear, insertPartner, listPartners, replaceWorkHours, searchStudents, updatePartner, workHoursOf } from '../infrastructure/partner-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const NAME_TAKEN = 'Nama DUDI sudah dipakai.';

async function partners(tx: Tx, today: string, id?: string): Promise<DudiPartner[]> {
  const rows = await listPartners(tx, today, id ? { id } : {});
  const hours = await workHoursOf(tx, rows.map((r) => r.id));
  return rows.map((r) => ({ ...r, workHours: hours.get(r.id) ?? [] }));
}

async function one(tx: Tx, today: string, id: string): Promise<DudiPartner> {
  const [row] = await partners(tx, today, id);
  if (!row) throw new NotFoundError('DUDI tidak ditemukan.');
  return row;
}

export function listDudiPartners(actor: Actor, today: string): Promise<DudiPartnerList> {
  authorize(actor, canSeeAllPkl);
  return withTenant(scope(actor), async (tx) => ({ items: await partners(tx, today) }));
}

export function createDudiPartner(actor: Actor, auditCtx: AuditContext, today: string, input: CreateDudiPartnerRequest): Promise<DudiPartner> {
  authorize(actor, canManagePkl);
  return withTenant(scope(actor), async (tx) => {
    const id = uuidv7();
    const { workHours, ...fields } = input;
    try {
      await insertPartner(tx, { id, schoolId: actor.schoolId, ...fields, createdBy: actor.userId });
    } catch (err) {
      if (isUniqueViolation(err, 'dudi_partners_school_id_name_key')) throw new ConflictError(NAME_TAKEN);
      throw err;
    }
    await replaceWorkHours(tx, actor.schoolId, id, workHours);
    await audit(tx, auditCtx, 'pkl.partner_created', { type: 'dudi_partner', id }, { after: { name: input.name, radiusM: input.radiusM, days: workHours.map((d) => d.day) } });
    return one(tx, today, id);
  });
}

/** Partial edit; workHours replaces every day (sessions already generated stay). */
export function patchDudiPartner(actor: Actor, auditCtx: AuditContext, today: string, partnerId: string, input: UpdateDudiPartnerRequest): Promise<DudiPartner> {
  authorize(actor, canManagePkl);
  return withTenant(scope(actor), async (tx) => {
    const before = await one(tx, today, partnerId);
    const { workHours, ...fields } = input;
    try {
      if (Object.keys(fields).length > 0) await updatePartner(tx, partnerId, fields);
    } catch (err) {
      if (isUniqueViolation(err, 'dudi_partners_school_id_name_key')) throw new ConflictError(NAME_TAKEN);
      throw err;
    }
    if (workHours) await replaceWorkHours(tx, actor.schoolId, partnerId, workHours);
    const changed = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
    const beforeFields = Object.fromEntries(Object.keys(changed).map((k) => [k, before[k as keyof DudiPartner]]));
    await audit(tx, auditCtx, 'pkl.partner_updated', { type: 'dudi_partner', id: partnerId }, { before: beforeFields, after: changed });
    return one(tx, today, partnerId);
  });
}

export function findPklStudents(actor: Actor, q: string): Promise<PklStudentList> {
  authorize(actor, canManagePkl);
  return withTenant(scope(actor), async (tx) => {
    const year = await activeYear(tx);
    return { items: year ? await searchStudents(tx, year.id, q) : [] };
  });
}

export function listSchoolMentors(actor: Actor): Promise<PklStaffList> {
  authorize(actor, canManagePkl);
  return withTenant(scope(actor), async (tx) => ({ items: await activeStaff(tx) }));
}
