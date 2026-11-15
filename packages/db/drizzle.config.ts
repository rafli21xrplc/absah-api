import { defineConfig } from 'drizzle-kit';

// Generation only (no DB connection). Migrations are applied by scripts/migrate.ts.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/index.ts',
  out: './migrations',
  casing: 'snake_case',
});
