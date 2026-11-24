import type { EarlyWarning } from '@absah/contracts';
import { describe, expect, it } from 'vitest';
import { atRiskStudents, attendanceTrend, combineSchools } from './dashboard';

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
      { date: '2026-11-18', presentRate: 1, present: 10, days: 10 },
      { date: '2026-11-20', presentRate: 0.95, present: 19, days: 20 },
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

describe('combineSchools (RKP-06)', () => {
  const school = (id: string, days: number, present: number, o: { total?: number; filled?: number; open?: number; risk?: number | null; mbg?: [number, number] | null } = {}) => ({
    schoolId: id,
    name: id,
    schoolDate: '2026-11-23',
    attendance: { days, present, presentRate: days === 0 ? null : present / days },
    sessions: { total: o.total ?? 0, filled: o.filled ?? 0, missed: 0, open: o.open ?? 0, fillRate: null },
    atRiskStudents: o.risk ?? null,
    mbg: o.mbg ? { enrolled: o.mbg[0], present: o.mbg[1] } : null,
  });

  it('recomputes rates from the sums, so a big school weighs more than a small one', () => {
    const { totals } = combineSchools([school('besar', 900, 810, { total: 30, filled: 27, open: 0 }), school('kecil', 100, 50, { total: 10, filled: 5, open: 5 })], []);
    expect(totals.attendance).toEqual({ days: 1000, present: 860, presentRate: 0.86 });
    // 32 filled of 35 due (5 open are not due): not the average of 0.9 and 1.
    expect(totals.sessions).toMatchObject({ total: 40, filled: 32, open: 5 });
    expect(totals.sessions.fillRate).toBeCloseTo(32 / 35, 3);
  });

  it('adds at-risk and MBG over the schools that have them, null when none does', () => {
    expect(combineSchools([school('a', 10, 10, { risk: 3, mbg: [10, 9] }), school('b', 10, 10), school('c', 10, 10, { risk: 0, mbg: [20, 18] })], []).totals).toMatchObject({ atRiskStudents: 3, mbg: { enrolled: 30, present: 27 } });
    expect(combineSchools([school('a', 10, 10)], []).totals).toMatchObject({ atRiskStudents: null, mbg: null });
  });

  it('merges the trends by date, oldest first', () => {
    const { trend } = combineSchools([], [
      [{ date: '2026-11-21', presentRate: 1, present: 10, days: 10 }, { date: '2026-11-20', presentRate: 0.5, present: 5, days: 10 }],
      [{ date: '2026-11-21', presentRate: 0.5, present: 5, days: 10 }],
    ]);
    expect(trend).toEqual([
      { date: '2026-11-20', present: 5, days: 10, presentRate: 0.5 },
      { date: '2026-11-21', present: 15, days: 20, presentRate: 0.75 },
    ]);
  });
});
