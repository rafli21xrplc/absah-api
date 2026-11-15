import { integrationPreset } from '@absah/config/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { ...integrationPreset, globalSetup: ['./test/global-setup.ts'] },
});
