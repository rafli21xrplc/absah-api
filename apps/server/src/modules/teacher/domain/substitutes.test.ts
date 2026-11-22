import type { SubstituteCandidate } from '@absah/contracts';
import { describe, expect, it } from 'vitest';
import { isSubstitutableMode, rankCandidates, unavailableReason } from './substitutes';

const set = (...ids: string[]) => new Set(ids);
const base = { absentTeacherId: 'absent', pool: set('absent', 'a', 'b', 'c', 'd'), onLeave: set('absent', 'b'), busy: set('c') };

describe('unavailableReason', () => {
  it.each([
    { name: 'a free teacher', userId: 'a', reason: null },
    { name: 'the absent teacher, who is on leave too', userId: 'absent', reason: 'is_absent_teacher' },
    { name: 'a teacher on approved izin', userId: 'b', reason: 'on_leave' },
    { name: 'a teacher with a lesson at that time', userId: 'c', reason: 'busy' },
    { name: 'someone who is not a teacher of the school', userId: 'x', reason: 'not_a_teacher' },
  ])('$name', ({ userId, reason }) => expect(unavailableReason({ ...base, userId })).toBe(reason));

  it('names izin before a clash when both apply', () => {
    expect(unavailableReason({ ...base, userId: 'b', busy: set('b') })).toBe('on_leave');
  });
});

const cand = (over: Partial<SubstituteCandidate> & { userId: string; name: string }): SubstituteCandidate => ({ checkedIn: false, sameSubject: false, substitutionsThisMonth: 0, ...over });

describe('rankCandidates', () => {
  it('puts those already at school first, then the same subject, then the lightest load, then name', () => {
    const ranked = rankCandidates([
      cand({ userId: '1', name: 'Dewi' }),
      cand({ userId: '2', name: 'Budi', sameSubject: true }),
      cand({ userId: '3', name: 'Citra', checkedIn: true, substitutionsThisMonth: 5 }),
      cand({ userId: '4', name: 'Adi', sameSubject: true, substitutionsThisMonth: 2 }),
      cand({ userId: '5', name: 'Eko', checkedIn: true, sameSubject: true, substitutionsThisMonth: 9 }),
    ]);
    expect(ranked.map((c) => c.name)).toEqual(['Eko', 'Citra', 'Budi', 'Adi', 'Dewi']);
  });

  it('breaks ties by name and does not change the input', () => {
    const input = [cand({ userId: '2', name: 'Zaki' }), cand({ userId: '1', name: 'Ani' })];
    expect(rankCandidates(input).map((c) => c.name)).toEqual(['Ani', 'Zaki']);
    expect(input.map((c) => c.name)).toEqual(['Zaki', 'Ani']);
  });
});

describe('isSubstitutableMode', () => {
  it.each([
    ['per_period', true],
    ['daily', true],
    ['activity', false],
    ['pkl', false],
  ])('%s is %s', (mode, ok) => expect(isSubstitutableMode(mode)).toBe(ok));
});
