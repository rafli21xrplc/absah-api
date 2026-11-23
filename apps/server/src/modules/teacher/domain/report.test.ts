import { describe, expect, it } from 'vitest';
import { classifyDays, monthSpan, presenceRate } from './report';

const days = ['2026-11-02', '2026-11-03', '2026-11-04', '2026-11-05', '2026-11-06'];

describe('classifyDays', () => {
  it('counts a check-in as present, and a late one as present and late', () => {
    const r = classifyDays({ schoolDays: days, checkIns: [{ date: '2026-11-02', late: false }, { date: '2026-11-03', late: true }], leaves: [] });
    expect(r.counts).toEqual({ present: 2, late: 1, leave: { sakit: 0, izin: 0, dinas: 0 }, noRecord: 3 });
    expect(r.days.map((d) => d.status)).toEqual(['present', 'late', 'none', 'none', 'none']);
  });

  it('counts a day on approved izin by kind, and only on school days', () => {
    const r = classifyDays({
      schoolDays: days,
      checkIns: [],
      leaves: [
        { kind: 'sakit', startsOn: '2026-10-30', endsOn: '2026-11-03' }, // starts before the month, the weekend is not a school day
        { kind: 'dinas', startsOn: '2026-11-05', endsOn: '2026-11-05' },
      ],
    });
    expect(r.counts.leave).toEqual({ sakit: 2, izin: 0, dinas: 1 });
    expect(r.counts.noRecord).toBe(2);
    expect(r.days.map((d) => d.status)).toEqual(['sakit', 'sakit', 'none', 'dinas', 'none']);
  });

  it('lets a check-in win over an izin the teacher did not use', () => {
    const r = classifyDays({ schoolDays: days, checkIns: [{ date: '2026-11-04', late: false }], leaves: [{ kind: 'izin', startsOn: '2026-11-04', endsOn: '2026-11-04' }] });
    expect(r.counts).toMatchObject({ present: 1, leave: { izin: 0 } });
    expect(r.days[2]?.status).toBe('present');
  });

  it('ignores a check-in on a day that is not a school day', () => {
    const r = classifyDays({ schoolDays: days, checkIns: [{ date: '2026-11-07', late: false }], leaves: [] });
    expect(r.counts.present).toBe(0);
  });

  it('adds up to the school days', () => {
    const r = classifyDays({ schoolDays: days, checkIns: [{ date: '2026-11-02', late: true }], leaves: [{ kind: 'sakit', startsOn: '2026-11-03', endsOn: '2026-11-04' }] });
    const { present, leave, noRecord } = r.counts;
    expect(present + leave.sakit + leave.izin + leave.dinas + noRecord).toBe(days.length);
  });
});

describe('presenceRate', () => {
  it.each([
    [0, 0, null],
    [20, 20, 100],
    [19, 20, 95],
    [1, 3, 33.3],
    [2, 3, 66.7],
    [0, 5, 0],
  ])('%i of %i is %s', (present, total, rate) => expect(presenceRate(present, total)).toBe(rate));
});

describe('monthSpan', () => {
  it.each([
    { name: 'a past month is counted whole', month: '2026-10', today: '2026-11-23', to: '2026-10-31', through: '2026-10-31' },
    { name: 'this month counts up to today', month: '2026-11', today: '2026-11-23', to: '2026-11-30', through: '2026-11-23' },
    { name: 'the last day of the month counts', month: '2026-11', today: '2026-11-30', to: '2026-11-30', through: '2026-11-30' },
    { name: 'a future month has nothing yet', month: '2026-12', today: '2026-11-23', to: '2026-12-31', through: null },
    { name: 'February of a leap year', month: '2028-02', today: '2028-03-05', to: '2028-02-29', through: '2028-02-29' },
    { name: 'February otherwise', month: '2026-02', today: '2026-03-05', to: '2026-02-28', through: '2026-02-28' },
  ])('$name', ({ month, today, to, through }) => {
    expect(monthSpan(month, today)).toEqual({ from: `${month}-01`, to, through });
  });
});
