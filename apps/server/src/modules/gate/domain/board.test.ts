import { describe, expect, it } from 'vitest';
import { boardByClass } from './board';

const s = (className: string, state: 'on' | 'late' | 'none' | 'izin') => ({ className, arrived: state === 'on' || state === 'late', late: state === 'late', excused: state === 'izin' });

describe('boardByClass', () => {
  it('counts on time, late and not in per rombel, and the izin among those not in', () => {
    const { classes, totals } = boardByClass([s('7A', 'on'), s('7A', 'late'), s('7A', 'none'), s('7A', 'izin'), s('7B', 'on'), s('7B', 'on')]);
    expect(classes).toEqual([
      { className: '7A', students: 4, onTime: 1, late: 1, notArrived: 2, excused: 1 },
      { className: '7B', students: 2, onTime: 2, late: 0, notArrived: 0, excused: 0 },
    ]);
    expect(totals).toEqual({ students: 6, onTime: 3, late: 1, notArrived: 2, excused: 1 });
  });

  it('is empty for a school without students', () => {
    expect(boardByClass([])).toEqual({ classes: [], totals: { students: 0, onTime: 0, late: 0, notArrived: 0, excused: 0 } });
  });

  it('does not count an arrived student as excused even if an izin covers the day', () => {
    expect(boardByClass([{ className: '7A', arrived: true, late: false, excused: true }]).totals.excused).toBe(0);
  });
});
