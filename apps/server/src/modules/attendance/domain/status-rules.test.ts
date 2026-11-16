import { describe, expect, it } from 'vitest';
import { computeDailyStatus, isSchoolDay, isoWeekday, marksAfter, resolveMarks, teacherCanSet, type SourcedStatus } from './status-rules';

const applyWrites = (writes: SourcedStatus[]) => resolveMarks(marksAfter(writes));

const w = (source: SourcedStatus['source'], status: SourcedStatus['status']): SourcedStatus => ({ source, status });

describe('source priority (8 scenarios)', () => {
  it.each([
    ['1. teacher corrects the gate pre-fill', [w('gate', 'T'), w('teacher', 'H')], w('teacher', 'H')],
    ['2. a late gate scan does not undo the teacher', [w('teacher', 'A'), w('gate', 'T')], w('teacher', 'A')],
    ['3. approved izin stands when the teacher marks alpa', [w('leave', 'I'), w('teacher', 'A')], w('leave', 'I')],
    ['4. izin approved after the teacher filled replaces it', [w('teacher', 'A'), w('leave', 'S')], w('leave', 'S')],
    ['5. the teacher may refill the session', [w('teacher', 'A'), w('teacher', 'H')], w('teacher', 'H')],
    ['6. sent home from UKS stays sakit when the teacher refills', [w('teacher', 'H'), w('uks', 'S'), w('teacher', 'H')], w('uks', 'S')],
    ['7. the PKL mentor decision beats the teacher', [w('teacher', 'A'), w('pkl_confirm', 'H')], w('pkl_confirm', 'H')],
    ['8. an approved correction is final, even over izin', [w('leave', 'I'), w('manual', 'A'), w('leave', 'S')], w('manual', 'A')],
  ])('%s', (_name, writes, expected) => {
    expect(applyWrites(writes)).toEqual(expected);
  });

  it('izin outranks UKS; the teacher sets students nothing higher has marked', () => {
    expect(applyWrites([w('leave', 'I'), w('uks', 'S')])).toEqual(w('leave', 'I'));
    expect(teacherCanSet(null)).toBe(true);
    expect(teacherCanSet(w('gate', 'T'))).toBe(true);
    expect(teacherCanSet(w('leave', 'I'))).toBe(false);
  });

  it('a cancelled izin brings back the next source, or nothing', () => {
    const marks = marksAfter([w('gate', 'T'), w('teacher', 'A'), w('leave', 'S')]);
    expect(resolveMarks(marks)).toEqual(w('leave', 'S'));
    expect(resolveMarks(marks.filter((m) => m.source !== 'leave'))).toEqual(w('teacher', 'A'));
    expect(resolveMarks(marks.filter((m) => m.source === 'leave').filter((m) => m.source !== 'leave'))).toBeNull();
  });
});

describe('computeDailyStatus', () => {
  it.each([
    [[], null],
    [['H'], 'H'],
    [['A'], 'A'],
    [['A', 'H', 'H'], 'H'],
    [['T', 'H', 'A'], 'T'],
    [['S', 'A', 'A'], 'A'],
    [['S', 'I', 'A'], 'S'],
    [['I', 'I', 'S'], 'I'],
  ] as const)('%j -> %s', (statuses, expected) => {
    expect(computeDailyStatus(statuses.map((status) => ({ status })))).toBe(expected);
  });
});

describe('isSchoolDay', () => {
  const none = new Set<number>();
  it('follows the calendar, then the configured days, then Senin-Jumat', () => {
    expect(isoWeekday('2026-11-16')).toBe(1);
    expect(isoWeekday('2026-11-22')).toBe(7);
    expect(isSchoolDay({ date: '2026-11-16', calendarKind: 'holiday', daysWithPeriods: none })).toEqual({ schoolDay: false, reason: 'holiday' });
    expect(isSchoolDay({ date: '2026-11-21', calendarKind: null, daysWithPeriods: none })).toEqual({ schoolDay: false, reason: 'not_school_day' });
    expect(isSchoolDay({ date: '2026-11-21', calendarKind: 'school_day', daysWithPeriods: none }).schoolDay).toBe(true);
    expect(isSchoolDay({ date: '2026-11-21', calendarKind: null, daysWithPeriods: new Set([1, 2, 3, 4, 5, 6]) }).schoolDay).toBe(true);
    expect(isSchoolDay({ date: '2026-11-20', calendarKind: null, daysWithPeriods: new Set([1, 2, 3, 4]) }).schoolDay).toBe(false);
  });
});
