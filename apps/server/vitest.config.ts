import { unitPreset } from '@absah/config/vitest';
import { defineConfig } from 'vitest/config';

export default defineConfig({ test: { ...unitPreset, include: ['src/**/*.test.ts', 'test/**/*.test.ts'] } });
