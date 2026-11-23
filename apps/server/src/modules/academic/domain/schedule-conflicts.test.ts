import { describe, expect, it } from 'vitest';
import { findScheduleConflicts, validateDayPeriods, type TimedSlot } from './schedule-conflicts';

const slot = (id: string, ownerType: 'class' | 'group', ownerId: string, teacherId: string | null, day = 1, period = 1): TimedSlot => ({
  id,
  ownerType,
  ownerId,
  day,
  period,
  teacherId,
});

const students: Record<string, string[]> = {
  'class:x1': ['s1', 's2', 's3'],
  'class:x2': ['s4', 's5'],
  'group:inf': ['s2', 's4'],
  'group:seni': ['s1'],
  'group:musik': ['s1'],
};
const studentsOf = (o: { ownerType: string; ownerId: string }) => new Set(students[`${o.ownerType}:${o.ownerId}`] ?? []);

describe('findScheduleConflicts', () => {
  it('finds nothing for different rombel, teachers and students at one time', () => {
    expect(findScheduleConflicts([slot('a', 'class', 'x1', 't1'), slot('b', 'class', 'x2', 't2')], studentsOf)).toEqual([]);
  });

  it('finds a teacher in two slots at the same time only', () => {
    const conflicts = findScheduleConflicts(
      [slot('a', 'class', 'x1', 't1'), slot('b', 'class', 'x2', 't1'), slot('c', 'class', 'x2', 't1', 1, 2)],
      studentsOf,
    );
    expect(conflicts.map((c) => [c.kind, c.a.id, c.b.id])).toEqual([['teacher', 'a', 'b']]);
  });

  it('finds students in a rombel slot and a group slot at once', () => {
    const conflicts = findScheduleConflicts([slot('a', 'class', 'x1', 't1'), slot('g', 'group', 'inf', 't2')], studentsOf);
    expect(conflicts).toEqual([expect.objectContaining({ kind: 'student', studentIds: ['s2'] })]);
  });

  it('finds students in two groups at once, and the same owner twice', () => {
    const conflicts = findScheduleConflicts(
      [slot('a', 'group', 'seni', 't1'), slot('b', 'group', 'musik', 't2'), slot('c', 'class', 'x2', 't3'), slot('d', 'class', 'x2', 't4')],
      studentsOf,
    );
    expect(conflicts.map((c) => c.kind).sort()).toEqual(['owner', 'student']);
  });
});

describe('validateDayPeriods', () => {
  it('accepts ordered periods and reports duplicates, inverted and overlapping times', () => {
    expect(
      validateDayPeriods([
        { number: 1, startsAt: '07:00', endsAt: '07:40' },
        { number: 2, startsAt: '07:40', endsAt: '08:20' },
      ]),
    ).toEqual([]);
    expect(
      validateDayPeriods([
        { number: 1, startsAt: '07:00', endsAt: '07:40' },
        { number: 1, startsAt: '08:00', endsAt: '07:50' },
        { number: 2, startsAt: '07:30', endsAt: '08:00' },
      ]),
    ).toEqual([
      'Jam ke-1 tercantum dua kali.',
      'Jam ke-1: jam mulai harus sebelum jam selesai.',
      'Jam ke-2 dimulai sebelum jam ke-1 selesai.',
    ]);
  });
});
