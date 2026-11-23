import type { EarlyWarning } from '@absah/contracts';
import { describe, expect, it } from 'vitest';
import { atRiskStudents, attendanceTrend } from './dashboard';

const counts = (H: number, T = 0, S = 0, I = 0, A = 0) => ({ H, T, S, I, A });
const warning = (id: string, name: string, kind: EarlyWarning['kind'], date: string): EarlyWarning => ({
  id: crypto.randomUUID(),
  student: { enrollmentId: id, name, className: 'VII A' },
  kind,
  date,
  dates: [date],
});

describe('attendanceTrend (RKP-05)', () => {
  it('is oldest first, counts T as present and leaves out dates without rekap', () => {
    const trend = attendanceTrend([
      { date: '2026-11-20', counts: counts(18, 1, 0, 0, 1) },
      { date: '2026-11-18', counts: counts(10, 0, 0, 0, 0) },
      { date: '2026-11-19', counts: counts(0) },
    ]);
    expect(trend).toEqual([
      { date: '2026-11-18', presentRate: 1, days: 10 },
      { date: '2026-11-20', presentRate: 0.95, days: 20 },
    ]);
  });
});

describe('atRiskStudents (RKP-05)', () => {
  it('folds warnings per student, ranks by number of kinds then recency, and counts them all', () => {
    const out = atRiskStudents(
      [
        warning('a', 'Ani', 'consecutive_alpa', '2026-11-17'),
        warning('b', 'Budi', 'repeated_late', '2026-11-20'),
        warning('a', 'Ani', 'repeated_late', '2026-11-19'),
        warning('a', 'Ani', 'repeated_late', '2026-11-21'),
        warning('c', 'Citra', 'consecutive_alpa', '2026-11-18'),
      ],
      2,
    );
    expect(out.students).toBe(3);
    expect(out.items.map((i) => i.name)).toEqual(['Ani', 'Budi']);
    expect(out.items[0]).toMatchObject({ kinds: ['consecutive_alpa', 'repeated_late'], lastDate: '2026-11-21' });
  });

  it('is empty without warnings', () => {
    expect(atRiskStudents([])).toEqual({ students: 0, items: [] });
  });
});
