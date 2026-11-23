import type { PklAssessmentItem } from '@absah/contracts';

/** The results table of the DUDI assessment (PKL-04), shared by the Excel and the PDF. Pure. */

export interface AssessmentTableRow {
  no: number;
  student: string;
  className: string;
  partner: string;
  period: string;
  /** One per column of `aspects`; null where the student has no score for it. */
  scores: (number | null)[];
  overall: number | null;
  note: string | null;
}

export interface AssessmentTable {
  /** Current aspects in form order, then names of retired aspects that still appear in given assessments (first appearance). */
  aspects: string[];
  rows: AssessmentTableRow[];
  assessed: number;
  /** Mean of the weighted scores given, one decimal; null when none. */
  average: number | null;
}

const date = (iso: string) => iso.split('-').reverse().join('-');

export function assessmentTable(items: readonly PklAssessmentItem[], currentAspects: readonly string[]): AssessmentTable {
  const aspects = [...currentAspects];
  for (const item of items) for (const s of item.assessment?.scores ?? []) if (!aspects.includes(s.aspectName)) aspects.push(s.aspectName);
  const rows = items.map((item, i) => ({
    no: i + 1,
    student: item.student.name,
    className: item.student.className,
    partner: item.partner.name,
    period: `${date(item.startsOn)} s.d. ${date(item.endsOn)}`,
    scores: aspects.map((name) => item.assessment?.scores.find((s) => s.aspectName === name)?.score ?? null),
    overall: item.assessment?.overall ?? null,
    note: item.assessment?.note ?? null,
  }));
  const given = rows.flatMap((r) => (r.overall === null ? [] : [r.overall]));
  return { aspects, rows, assessed: given.length, average: given.length === 0 ? null : Math.round((given.reduce((n, v) => n + v, 0) / given.length) * 10) / 10 };
}
