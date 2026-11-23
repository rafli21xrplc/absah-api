import { describe, expect, it } from 'vitest';
import { assessmentWindow, checkScores, weightedScore } from './assessment-rules';

describe('assessmentWindow (PKL-04)', () => {
  it('opens 14 days before the end and closes 30 days after it', () => {
    const ends = '2027-03-31';
    const at = (today: string) => assessmentWindow(ends, today);
    expect([at('2027-03-16'), at('2027-03-17'), at('2027-03-31'), at('2027-04-30'), at('2027-05-01')]).toEqual(['not_yet', 'open', 'open', 'open', 'closed']);
  });
});

describe('weightedScore (PKL-04)', () => {
  it('weighs the aspects and keeps one decimal', () => {
    expect(weightedScore([{ weight: 2, score: 90 }, { weight: 1, score: 80 }, { weight: 3, score: 70 }])).toBe(78.3);
    expect(weightedScore([{ weight: 1, score: 85 }])).toBe(85);
  });
  it('is null without scores', () => {
    expect(weightedScore([])).toBeNull();
  });
});

describe('checkScores', () => {
  it('wants every aspect once and nothing else', () => {
    expect(checkScores(['a', 'b'], [{ aspectId: 'a' }, { aspectId: 'b' }])).toEqual([]);
    expect(checkScores(['a', 'b'], [{ aspectId: 'a' }])).toEqual([{ kind: 'missing', aspectId: 'b' }]);
    expect(checkScores(['a'], [{ aspectId: 'a' }, { aspectId: 'a' }, { aspectId: 'z' }])).toEqual([{ kind: 'duplicate', aspectId: 'a' }, { kind: 'unknown', aspectId: 'z' }]);
  });
});
