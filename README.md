# absah-api

Backend Absah: API Express 5, worker pg-boss, skema database (Drizzle + RLS), dan paket kontrak
bersama. Frontend ada di [absah-app](https://github.com/rafli21xrplc/absah-app).

- Arsitektur: [docs/architecture.md](docs/architecture.md)
- Urutan prompt pengembangan: [docs/prompts.md](docs/prompts.md)
- Lingkungan dan variabel: [docs/environments.md](docs/environments.md)
- Aturan untuk Claude Code dan kontributor: [CLAUDE.md](CLAUDE.md)

## Mulai

```bash
fnm use            # Node 22 (.nvmrc)
corepack enable    # pnpm 9
pnpm install
cp .env.example .env.local   # isi DATABASE_URL, DATABASE_URL_DIRECT, TEST_DATABASE_URL
pnpm db:migrate && pnpm db:check-rls
pnpm dev           # http di :4000 + worker
pnpm turbo lint typecheck test
```

Uji integrasi butuh Postgres lokal (`docker compose up -d` atau instalasi lokal) di `TEST_DATABASE_URL`.

| Paket | Isi |
| --- | --- |
| `apps/server` | `http.ts` (API `/api/v1`), `worker.ts` (pg-boss), modul per domain |
| `packages/db` | schema Drizzle, migrasi SQL, `withTenant`, `db:check-rls` |
| `packages/contracts` | schema Zod per endpoint + OpenAPI (dipakai juga oleh absah-app) |
| `packages/capabilities` | katalog capability + preset jenjang (dipakai juga oleh absah-app) |
| `packages/config` | tsconfig, eslint, preset vitest |
