import type { PklAssessmentItem } from '@absah/contracts';
import { describe, expect, it } from 'vitest';
import { assessmentTable } from './assessment-table';

const item = (name: string, scores: Record<string, number> | null, overall = 0): PklAssessmentItem => ({
  placementId: crypto.randomUUID(),
  student: { name, className: 'XI TKJ 1' },
  partner: { id: crypto.randomUUID(), name: 'PT Maju Jaya' },
  startsOn: '2027-01-04',
  endsOn: '2027-03-31',
  window: 'open',
  assessment: scores ? { overall, note: null, assessedAt: '2027-03-20T03:00:00+07:00', scores: Object.entries(scores).map(([aspectName, score]) => ({ aspectId: crypto.randomUUID(), aspectName, weight: 1, score })) } : null,
});

describe('assessmentTable (PKL-04)', () => {
  it('has a column per current aspect, then retired ones still in use, and blanks where a score is missing', () => {
    const t = assessmentTable([item('ANI', { Disiplin: 90, 'Kerja sama': 80 }, 85), item('BUDI', { Disiplin: 70, Inisiatif: 60 }, 65), item('CITRA', null)], ['Disiplin', 'Inisiatif']);
    expect(t.aspects).toEqual(['Disiplin', 'Inisiatif', 'Kerja sama']);
    expect(t.rows.map((r) => r.scores)).toEqual([[90, null, 80], [70, 60, null], [null, null, null]]);
    expect(t.rows[0]).toMatchObject({ no: 1, period: '04-01-2027 s.d. 31-03-2027', overall: 85 });
    expect(t.rows[2]?.overall).toBeNull();
  });

  it('averages only the assessments given', () => {
    expect(assessmentTable([item('A', { X: 1 }, 85), item('B', { X: 1 }, 70), item('C', null)], ['X'])).toMatchObject({ assessed: 2, average: 77.5 });
    expect(assessmentTable([item('C', null)], []).average).toBeNull();
  });
});
