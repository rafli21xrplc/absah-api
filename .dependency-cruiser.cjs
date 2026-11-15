/** Architecture rules from docs/architecture.md "Aturan antarmodul". Run: pnpm depcruise */
const MODULES = '^apps/server/src/modules/';

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: 'module-public-api-only',
      comment: 'A module may import another module only through its index.ts.',
      severity: 'error',
      from: { path: `${MODULES}([^/]+)/` },
      to: {
        path: `${MODULES}[^/]+/.+`,
        pathNot: [`${MODULES}$1/`, `${MODULES}[^/]+/index\\.ts$`],
      },
    },
    {
      name: 'domain-is-pure',
      comment: 'domain/ has no I/O: only its own domain/, shared/policy.ts, contracts, capabilities and zod.',
      severity: 'error',
      from: { path: `${MODULES}([^/]+)/domain/` },
      to: {
        pathNot: [
          `${MODULES}$1/domain/`,
          '^apps/server/src/shared/policy\\.ts$',
          '^packages/(contracts|capabilities)/',
          'node_modules/zod/',
        ],
      },
    },
    {
      name: 'packages-do-not-import-apps',
      severity: 'error',
      from: { path: '^packages/' },
      to: { path: '^apps/' },
    },
    {
      name: 'shared-packages-stay-pure',
      comment: 'contracts and capabilities are consumed by absah-app; no db, server or node I/O.',
      severity: 'error',
      from: { path: '^packages/(contracts|capabilities)/src/', pathNot: '^packages/contracts/src/openapi\\.ts$' },
      to: { path: ['^packages/db/', '^apps/', 'node_modules/(pg|drizzle-orm|express|pg-boss)/'] },
    },
    {
      name: 'policy-is-pure',
      comment: 'shared/policy.ts is importable from domain/, so it must stay free of I/O.',
      severity: 'error',
      from: { path: '^apps/server/src/shared/policy\\.ts$' },
      to: { pathNot: ['^packages/contracts/', 'node_modules/zod/'] },
    },
    {
      name: 'no-circular',
      severity: 'error',
      from: {},
      to: { circular: true },
    },
  ],
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['(^|/)dist/', '(^|/)\\.turbo/'] },
    tsPreCompilationDeps: true,
    combinedDependencies: true,
    preserveSymlinks: false,
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['import', 'require', 'node', 'default', 'types'],
      extensions: ['.ts', '.js', '.json'],
    },
    tsConfig: { fileName: 'packages/config/tsconfig.base.json' },
  },
};
