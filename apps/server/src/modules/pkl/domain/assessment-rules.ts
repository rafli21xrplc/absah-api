import { PKL_ASSESSMENT_OPEN_AFTER_DAYS, PKL_ASSESSMENT_OPEN_BEFORE_DAYS, type PklAssessmentWindow } from '@absah/contracts';

/** Pure rules of the DUDI assessment (PKL-04). The domain imports nothing from shared, so day arithmetic is local. */

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** The form opens shortly before the placement ends and closes a month after, so the industry supervisor grades at the end, not at the start. */
export function assessmentWindow(endsOn: string, today: string): PklAssessmentWindow {
  if (today < addDays(endsOn, -PKL_ASSESSMENT_OPEN_BEFORE_DAYS)) return 'not_yet';
  if (today > addDays(endsOn, PKL_ASSESSMENT_OPEN_AFTER_DAYS)) return 'closed';
  return 'open';
}

/** Weighted average to one decimal; null without scores. */
export function weightedScore(scores: readonly { weight: number; score: number }[]): number | null {
  const weights = scores.reduce((n, s) => n + s.weight, 0);
  if (weights === 0) return null;
  return Math.round((scores.reduce((n, s) => n + s.score * s.weight, 0) / weights) * 10) / 10;
}

export type ScoreProblem = { kind: 'missing'; aspectId: string } | { kind: 'unknown'; aspectId: string } | { kind: 'duplicate'; aspectId: string };

/** Every current aspect needs exactly one score, and no score may name an aspect the form does not ask for. */
export function checkScores(aspectIds: readonly string[], scores: readonly { aspectId: string }[]): ScoreProblem[] {
  const known = new Set(aspectIds);
  const seen = new Set<string>();
  const problems: ScoreProblem[] = [];
  for (const s of scores) {
    if (!known.has(s.aspectId)) problems.push({ kind: 'unknown', aspectId: s.aspectId });
    else if (seen.has(s.aspectId)) problems.push({ kind: 'duplicate', aspectId: s.aspectId });
    seen.add(s.aspectId);
  }
  for (const id of aspectIds) if (!seen.has(id)) problems.push({ kind: 'missing', aspectId: id });
  return problems;
}
