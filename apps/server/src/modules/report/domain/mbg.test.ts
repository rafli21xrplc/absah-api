import { describe, expect, it } from 'vitest';
import { changedCounts, clockMinutes, countMbg, isCutoffDue, mbgTotal } from './mbg';

const classes = [
  { classId: 'a', name: 'VII A' },
  { classId: 'b', name: 'VII B' },
  { classId: 'c', name: 'VII C' },
];

describe('countMbg', () => {
  it('counts H and T as present, S/I/A not, and nothing recorded apart', () => {
    const rows = countMbg(classes, [
      { classId: 'a', status: 'H' },
      { classId: 'a', status: 'T' },
      { classId: 'a', status: 'S' },
      { classId: 'a', status: 'I' },
      { classId: 'a', status: 'A' },
      { classId: 'b', status: null },
      { classId: 'b', status: 'H' },
      { classId: 'x', status: 'H' }, // rombel not listed: ignored
    ]);
    expect(rows).toEqual([
      { classId: 'a', name: 'VII A', enrolled: 5, present: 2, unrecorded: 0 },
      { classId: 'b', name: 'VII B', enrolled: 2, present: 1, unrecorded: 1 },
      { classId: 'c', name: 'VII C', enrolled: 0, present: 0, unrecorded: 0 },
    ]);
    expect(mbgTotal(rows)).toEqual({ enrolled: 7, present: 3, unrecorded: 1 });
  });
});

describe('cutoff', () => {
  it.each([
    ['08:30', 509, false],
    ['08:30', 510, true],
    ['08:30:00', 600, true],
    ['07:05', 424, false],
  ])('cutoff %s at minute %i -> %s', (cutoff, minutes, due) => {
    expect(isCutoffDue(minutes, cutoff)).toBe(due);
  });

  it('reads Postgres time values', () => {
    expect(clockMinutes('08:30:00')).toBe(510);
  });
});

describe('changedCounts', () => {
  it('keeps only rombel whose numbers changed or that were not stored', () => {
    const stored = new Map([
      ['a', { enrolled: 5, present: 2, unrecorded: 0 }],
      ['b', { enrolled: 2, present: 1, unrecorded: 1 }],
    ]);
    const fresh = [
      { classId: 'a', name: 'VII A', enrolled: 5, present: 2, unrecorded: 0 },
      { classId: 'b', name: 'VII B', enrolled: 2, present: 2, unrecorded: 0 },
      { classId: 'c', name: 'VII C', enrolled: 1, present: 1, unrecorded: 0 },
    ];
    expect(changedCounts(stored, fresh).map((r) => r.classId)).toEqual(['b', 'c']);
  });
});
