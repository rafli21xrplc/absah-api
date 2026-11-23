import type { PklAssessment, PklAssessmentExportQuery, PklAssessmentForm, PklAssessmentItem, PklAssessmentList, SavePklAssessmentRequest } from '@absah/contracts';
import type { Tx } from '@absah/db';
import { uuidv7 } from 'uuidv7';
import { audit, type AuditContext } from '../../../shared/audit';
import { authorize } from '../../../shared/authorize';
import { withTenant } from '../../../shared/db';
import { ConflictError, NotFoundError, ValidationError } from '../../../shared/errors';
import type { Actor } from '../../../shared/policy';
import { assessmentTable } from '../domain/assessment-table';
import { assessmentWindow, checkScores, type ScoreProblem, weightedScore } from '../domain/assessment-rules';
import { canExportPklAssessment, canReadPklAssessment, canSeeAllPkl, canSuperviseAtDudi } from '../domain/policies';
import { assessmentPdf, assessmentWorkbook } from '../infrastructure/assessment-files';
import { activeAspects, assessmentsOf, saveAssessment, schoolName, type StoredAssessment } from '../infrastructure/assessment-repo';
import { listPlacements, type PlacementFilter, type PlacementRow } from '../infrastructure/placement-repo';

const scope = (actor: Actor) => ({ schoolId: actor.schoolId, userId: actor.userId });

/** Managers and kepsek see every placement; an industry supervisor theirs; a guru pembimbing the ones they supervise. */
function visibleTo(actor: Actor): PlacementFilter {
  if (canSeeAllPkl.allows(actor)) return {};
  return canSuperviseAtDudi.allows(actor) ? { industryMentorId: actor.userId } : { schoolMentorId: actor.userId };
}

function assessmentView(a: StoredAssessment): PklAssessment {
  return { overall: weightedScore(a.scores) ?? 0, note: a.note, assessedAt: a.updatedAt.toISOString(), scores: a.scores };
}

const item = (r: PlacementRow, a: StoredAssessment | undefined, today: string): PklAssessmentItem => ({
  placementId: r.id,
  student: { name: r.studentName, className: r.className },
  partner: { id: r.partnerId, name: r.partnerName },
  startsOn: r.startsOn,
  endsOn: r.endsOn,
  window: assessmentWindow(r.endsOn, today),
  assessment: a ? assessmentView(a) : null,
});

/** GET /pkl/assessments. Cancelled placements are left out. */
export function listAssessments(actor: Actor, today: string): Promise<PklAssessmentList> {
  authorize(actor, canReadPklAssessment);
  return withTenant(scope(actor), async (tx) => {
    const rows = (await listPlacements(tx, visibleTo(actor))).filter((r) => r.status === 'active');
    const done = await assessmentsOf(tx, rows.map((r) => r.id));
    return { items: rows.map((r) => item(r, done.get(r.id), today)) };
  });
}

async function form(tx: Tx, actor: Actor, placementId: string, today: string): Promise<{ form: PklAssessmentForm; row: PlacementRow }> {
  const [row] = await listPlacements(tx, { ...visibleTo(actor), id: placementId });
  if (!row) throw new NotFoundError('Penempatan tidak ditemukan.');
  const [stored, aspects] = await Promise.all([assessmentsOf(tx, [row.id]), activeAspects(tx)]);
  return { row, form: { ...item(row, stored.get(row.id), today), aspects: aspects.map(({ position: _p, ...x }) => x) } };
}

/** GET /pkl/placements/{id}/assessment. */
export function getAssessment(actor: Actor, placementId: string, today: string): Promise<PklAssessmentForm> {
  authorize(actor, canReadPklAssessment);
  return withTenant(scope(actor), async (tx) => (await form(tx, actor, placementId, today)).form);
}

const MESSAGES: Record<ScoreProblem['kind'], string> = {
  missing: 'Ada aspek yang belum dinilai.',
  unknown: 'Ada aspek yang tidak ada di formulir. Muat ulang formulir.',
  duplicate: 'Satu aspek dinilai dua kali.',
};

/**
 * PUT /pkl/placements/{id}/assessment: the industry supervisor of the placement grades every current aspect between 14 days before
 * the placement ends and 30 days after. Giving it again corrects it (until the window closes); other supervisors' students are 404.
 */
export function giveAssessment(actor: Actor, auditCtx: AuditContext, placementId: string, today: string, input: SavePklAssessmentRequest): Promise<PklAssessmentForm> {
  authorize(actor, canSuperviseAtDudi);
  return withTenant(scope(actor), async (tx) => {
    const { row } = await form(tx, actor, placementId, today);
    if (row.status === 'cancelled') throw new ConflictError('Penempatan ini dibatalkan.', { reason: 'placement_cancelled' });
    const window = assessmentWindow(row.endsOn, today);
    if (window === 'not_yet') throw new ConflictError('Penilaian dibuka 14 hari sebelum masa PKL berakhir.', { reason: 'window_not_open' });
    if (window === 'closed') throw new ConflictError('Masa pengisian penilaian sudah ditutup. Hubungi guru pembimbing sekolah.', { reason: 'window_closed' });
    const aspects = await activeAspects(tx);
    if (aspects.length === 0) throw new ConflictError('Sekolah belum menyusun aspek penilaian.', { reason: 'no_aspects' });
    const problems = checkScores(aspects.map((a) => a.id), input.scores);
    if (problems.length > 0) throw new ValidationError(problems.map((p) => ({ path: 'scores', message: MESSAGES[p.kind] })));
    const scores = aspects.map((a) => ({ aspectId: a.id, aspectName: a.name, weight: a.weight, score: input.scores.find((s) => s.aspectId === a.id)?.score ?? 0 }));
    await saveAssessment(tx, { schoolId: actor.schoolId, placementId, assessedBy: actor.userId, note: input.note?.trim() || null, scores, newId: uuidv7() });
    await audit(tx, auditCtx, 'pkl.assessment_given', { type: 'pkl_placement', id: placementId }, { after: { overall: weightedScore(scores) } });
    return (await form(tx, actor, placementId, today)).form;
  });
}

/** GET /pkl/assessments/export: the results the caller may see as Excel or PDF, optionally of one DUDI. */
export function exportAssessments(actor: Actor, today: string, query: PklAssessmentExportQuery): Promise<{ file: Buffer; fileName: string; contentType: string }> {
  authorize(actor, canExportPklAssessment);
  return withTenant(scope(actor), async (tx) => {
    const rows = (await listPlacements(tx, { ...visibleTo(actor), ...(query.partnerId ? { partnerId: query.partnerId } : {}) })).filter((r) => r.status === 'active');
    const [done, aspects, name] = await Promise.all([assessmentsOf(tx, rows.map((r) => r.id)), activeAspects(tx), schoolName(tx, actor.schoolId)]);
    const table = assessmentTable(rows.map((r) => item(r, done.get(r.id), today)), aspects.map((a) => a.name));
    const info = { schoolName: name, printedOn: today.split('-').reverse().join('-') };
    return query.format === 'xlsx'
      ? { file: await assessmentWorkbook(table, info), fileName: `penilaian-dudi-${today}.xlsx`, contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }
      : { file: await assessmentPdf(table, info), fileName: `penilaian-dudi-${today}.pdf`, contentType: 'application/pdf' };
  });
}
