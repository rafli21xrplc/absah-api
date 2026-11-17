import { integrationPreset } from '@absah/config/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { ...integrationPreset, include: [...integrationPreset.include, 'seed/**/*.test.ts'], globalSetup: ['./test/global-setup.ts'] },
});
