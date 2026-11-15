import { describe, expect, it } from 'vitest';
import { integrationPreset, unitPreset } from './vitest.preset';

describe('vitest presets', () => {
  it('runs integration test files serially', () => {
    expect(integrationPreset.fileParallelism).toBe(false);
    expect(unitPreset.passWithNoTests).toBe(false);
  });
});
