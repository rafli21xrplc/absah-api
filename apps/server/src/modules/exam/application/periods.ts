import type { CreateExamPeriodRequest, ExamPeriod, ExamPeriodList, UpdateExamPeriodRequest } from '@absah/contracts';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import { isUniqueViolation } from '../../../shared/pg-errors';
import type { Actor } from '../../../shared/policy';
import { periodProblem } from '../domain/period-rules';
import { canManageExams, canReadExams } from '../domain/policies';
import { activeYearId, countFeeTypes, findPeriod, insertPeriod, listPeriods, updatePeriod, type ExamPeriodRow } from '../infrastructure/period-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });
const NAME_KEY = 'exam_periods_school_year_name_key';
const NAME_TAKEN = 'Nama ujian sudah dipakai pada tahun ajaran ini.';
/** The audit sanitiser redacts any key called "name" (personal data); an exam's title is not, so it is logged as "period". */
const forAudit = (fields: Record<string, unknown>) => Object.fromEntries(Object.entries(fields).map(([k, v]) => [k === 'name' ? 'period' : k, v]));

export function viewPeriod(row: ExamPeriodRow): ExamPeriod {
  return {
    id: row.id,
    name: row.name,
    academicYear: { id: row.academicYearId, name: row.academicYearName },
    startsOn: row.startsOn,
    endsOn: row.endsOn,
    minAttendance: row.minAttendance,
    attendanceFrom: row.attendanceFrom,
    excusedCounts: row.excusedCounts,
    requirePaid: row.requirePaid,
    feeTypeIds: row.feeTypeIds,
    closed: row.closedAt !== null,
  };
}

export function listExamPeriods(actor: Actor, includeClosed: boolean): Promise<ExamPeriodList> {
  authorize(actor, canReadExams);
  return withTenant(scope(actor), async (tx) => ({ items: (await listPeriods(tx, includeClosed)).map(viewPeriod) }));
}

async function checkFeeTypes(tx: Parameters<typeof countFeeTypes>[0], ids: string[]) {
  if (new Set(ids).size !== ids.length || (await countFeeTypes(tx, ids)) !== ids.length) throw new ValidationError([{ path: 'feeTypeIds', message: 'Jenis tagihan tidak dikenal.' }]);
}

/** POST /exam/periods: in the active academic year. */
export function createExamPeriod(actor: Actor, auditCtx: AuditContext, input: CreateExamPeriodRequest): Promise<ExamPeriod> {
  authorize(actor, canManageExams);
  const problem = periodProblem(input);
  if (problem) throw new ValidationError([{ path: 'period', message: problem }]);
  return withTenant(scope(actor), async (tx) => {
    const academicYearId = await activeYearId(tx);
    if (!academicYearId) throw new ConflictError('Belum ada tahun ajaran aktif.', { reason: 'no_active_year' });
    await checkFeeTypes(tx, input.feeTypeIds);
    const id = uuidv7();
    try {
      await insertPeriod(tx, { id, schoolId: actor.schoolId, academicYearId, ...input, createdBy: actor.userId });
    } catch (err) {
      if (isUniqueViolation(err, NAME_KEY)) throw new ConflictError(NAME_TAKEN, { reason: 'name_taken' });
      throw err;
    }
    await audit(tx, auditCtx, 'exam.period_created', { type: 'exam_period', id }, { after: forAudit(input) });
    const row = await findPeriod(tx, id);
    if (!row) throw new Error('exam period vanished');
    return viewPeriod(row);
  });
}

/** PATCH /exam/periods/{id}: partial; `closed` closes or reopens it. Who may sit follows the rule at once (it is never stored). */
export function updateExamPeriod(actor: Actor, auditCtx: AuditContext, id: string, input: UpdateExamPeriodRequest, now = new Date()): Promise<ExamPeriod> {
  authorize(actor, canManageExams);
  return withTenant(scope(actor), async (tx) => {
    const before = await findPeriod(tx, id);
    if (!before) throw new NotFoundError('Ujian tidak ditemukan.');
    const { closed, ...fields } = input;
    const changed = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) as Omit<UpdateExamPeriodRequest, 'closed'>;
    const after = { startsOn: before.startsOn, endsOn: before.endsOn, attendanceFrom: before.attendanceFrom, requirePaid: before.requirePaid, feeTypeIds: before.feeTypeIds, ...changed };
    const problem = periodProblem(after);
    if (problem) throw new ValidationError([{ path: 'period', message: problem }]);
    if (changed.feeTypeIds) await checkFeeTypes(tx, changed.feeTypeIds);
    const closedAt = closed === undefined ? undefined : closed ? (before.closedAt ?? now) : null;
    if (Object.keys(changed).length > 0 || closedAt !== undefined) {
      try {
        await updatePeriod(tx, id, { ...changed, ...(closedAt === undefined ? {} : { closedAt }) });
      } catch (err) {
        if (isUniqueViolation(err, NAME_KEY)) throw new ConflictError(NAME_TAKEN, { reason: 'name_taken' });
        throw err;
      }
      const beforeFields = Object.fromEntries(Object.keys(changed).map((k) => [k, before[k as keyof typeof before]]));
      await audit(tx, auditCtx, 'exam.period_updated', { type: 'exam_period', id }, { before: forAudit({ ...beforeFields, ...(closed === undefined ? {} : { closed: before.closedAt !== null }) }), after: forAudit({ ...changed, ...(closed === undefined ? {} : { closed }) }) });
    }
    const row = await findPeriod(tx, id);
    if (!row) throw new Error('exam period vanished');
    return viewPeriod(row);
  });
}
