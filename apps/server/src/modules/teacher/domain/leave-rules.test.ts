import { describe, expect, it } from 'vitest';
import { checkTeacherLeaveDates, mayCancelLeave } from './leave-rules';

const TODAY = '2026-11-23';

describe('checkTeacherLeaveDates', () => {
  it.each([
    { name: 'one day today', input: { startsOn: '2026-11-23', endsOn: '2026-11-23' }, paths: [] },
    { name: 'a week ahead', input: { startsOn: '2026-12-01', endsOn: '2026-12-07' }, paths: [] },
    { name: 'exactly 30 days', input: { startsOn: '2026-11-24', endsOn: '2026-12-23' }, paths: [] },
    { name: '31 days', input: { startsOn: '2026-11-24', endsOn: '2026-12-24' }, paths: ['endsOn'] },
    { name: 'ends before it starts', input: { startsOn: '2026-11-25', endsOn: '2026-11-24' }, paths: ['endsOn'] },
    { name: 'started 7 days ago (sick, told late)', input: { startsOn: '2026-11-16', endsOn: '2026-11-23' }, paths: [] },
    { name: 'started 8 days ago', input: { startsOn: '2026-11-15', endsOn: '2026-11-23' }, paths: ['startsOn'] },
  ])('$name', ({ input, paths }) => {
    expect(checkTeacherLeaveDates(input, TODAY).map((p) => p.path)).toEqual(paths);
  });
});

describe('mayCancelLeave', () => {
  it.each([
    { name: 'pending and ahead', leave: { status: 'pending', endsOn: '2026-11-30' }, ok: true },
    { name: 'approved, ends today', leave: { status: 'approved', endsOn: TODAY }, ok: true },
    { name: 'approved and over', leave: { status: 'approved', endsOn: '2026-11-22' }, ok: false },
    { name: 'rejected', leave: { status: 'rejected', endsOn: '2026-11-30' }, ok: false },
    { name: 'already cancelled', leave: { status: 'cancelled', endsOn: '2026-11-30' }, ok: false },
  ])('$name', ({ leave, ok }) => expect(mayCancelLeave(leave, TODAY)).toBe(ok));
});
