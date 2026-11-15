import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { http: 'src/entrypoints/http.ts', worker: 'src/entrypoints/worker.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node22',
  sourcemap: true,
  clean: true,
  // Workspace packages ship TypeScript source, so bundle them; keep npm deps external.
  noExternal: [/^@absah\//],
  // Bundled CommonJS deps (pg) call require(); give the ESM bundle a real one.
  banner: { js: "import { createRequire as __absahCreateRequire } from 'node:module'; const require = __absahCreateRequire(import.meta.url);" },
});
