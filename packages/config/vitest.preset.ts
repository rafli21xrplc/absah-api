// Shared Vitest options. Import in a package's vitest.config.ts and spread into `test`.
import type { ViteUserConfig } from 'vitest/config';

type TestOptions = NonNullable<ViteUserConfig['test']>;

export const unitPreset = {
  include: ['src/**/*.test.ts'],
  environment: 'node',
  passWithNoTests: false,
} satisfies TestOptions;

/** Integration tests share one Postgres database, so files run serially. */
export const integrationPreset = {
  ...unitPreset,
  include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
  fileParallelism: false,
  testTimeout: 30_000,
  hookTimeout: 60_000,
} satisfies TestOptions;
