import { describe, expect, it } from 'vitest';
import { isLevel, LEVELS } from './index';

describe('levels', () => {
  it('lists the four school levels', () => {
    expect(LEVELS).toEqual(['sd', 'smp', 'sma', 'smk']);
  });

  it('narrows known levels only', () => {
    expect(isLevel('smk')).toBe(true);
    expect(isLevel('mi')).toBe(false);
    expect(isLevel(1)).toBe(false);
  });
});
