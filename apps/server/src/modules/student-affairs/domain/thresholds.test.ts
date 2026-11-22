import { describe, expect, it } from 'vitest';
import { crossedThresholds } from './thresholds';

const tiers = [
  { id: 'c', minPoints: 100 },
  { id: 'a', minPoints: 25 },
  { id: 'b', minPoints: 50 },
];
const ids = (before: number, after: number, list = tiers) => crossedThresholds(before, after, list).map((t) => t.id);

describe('crossedThresholds', () => {
  it.each([
    { name: 'stays below the lowest tier', before: 0, after: 24, expected: [] },
    { name: 'reaches a tier exactly', before: 20, after: 25, expected: ['a'] },
    { name: 'was already on the tier', before: 25, after: 30, expected: [] },
    { name: 'one step takes it past two tiers, lowest first', before: 20, after: 60, expected: ['a', 'b'] },
    { name: 'one step past all tiers', before: 0, after: 150, expected: ['a', 'b', 'c'] },
    { name: 'lands between tiers after crossing one', before: 40, after: 49, expected: [] },
    { name: 'a reversal lowers the total: nothing crossed', before: 60, after: 40, expected: [] },
    { name: 'no change', before: 30, after: 30, expected: [] },
    { name: 'climbing back over a tier crosses it again', before: 20, after: 26, expected: ['a'] },
  ])('$name', ({ before, after, expected }) => {
    expect(ids(before, after)).toEqual(expected);
  });

  it('has nothing to cross with no tiers', () => {
    expect(ids(0, 500, [])).toEqual([]);
  });

  it('keeps the extra fields of the tier it returns', () => {
    expect(crossedThresholds(0, 30, [{ id: 'x', minPoints: 10, label: 'SP1' }])).toEqual([{ id: 'x', minPoints: 10, label: 'SP1' }]);
  });
});
