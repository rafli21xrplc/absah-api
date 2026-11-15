# Lingkungan dan variabel

Empat lingkungan: **dev** (laptop), **preview** (per PR), **staging**, **production**. Nilai rahasia
tidak pernah masuk repo (repo ini publik). Lokal: `.env.local` di root repo (gitignored), salin dari
`.env.example`. Lingkungan lain: secret di platform hosting atau GitHub Actions.

## Variabel absah-api

| Variabel | Dipakai oleh | dev | preview | staging | production |
| --- | --- | --- | --- | --- | --- |
| `NODE_ENV` | server | `development` | `production` | `production` | `production` |
| `PORT` | http | `4000` | platform | platform | platform |
| `LOG_LEVEL` | http, worker | `debug`/`info` | `info` | `info` | `info` |
| `APP_VERSION` | http (`/health`, OpenAPI) | `0.0.0` | SHA commit | tag rilis | tag rilis |
| `DATABASE_URL` | http, worker | Neon dev, **pooled** | branch Neon PR, pooled | Neon staging, pooled | Neon prod, pooled |
| `DATABASE_URL_DIRECT` | migrasi, `db:check-rls`, seed, pg-boss | Neon dev, **direct** | branch PR, direct | staging, direct | prod, direct |
| `DB_APP_ROLE` | `withTenant` | `absah_app` | `absah_app` | `absah_app` | `absah_app` |
| `TEST_DATABASE_URL` | uji integrasi | Postgres lokal | – (CI pakai service) | – | – |

Variabel yang menyusul di fase berikutnya: `BETTER_AUTH_SECRET`, `ENCRYPTION_KEYS` (Fase 1),
`R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET` (Fase 2), dan `WHATSAPP_*` (Fase 3).

### Pooled dan direct

- **Pooled** (host berisi `-pooler`, PgBouncer mode transaksi): dipakai API. Aman karena `withTenant`
  hanya memakai `set_config(..., true)` yang berlaku per transaksi.
- **Direct** (host tanpa `-pooler`): dipakai DDL/migrasi, `db:check-rls`, seed, dan pg-boss
  (pg-boss butuh sesi yang stabil untuk maintenance).
- Pakai `sslmode=verify-full` (node-postgres memperlakukan `require` sebagai `verify-full` dan memberi peringatan).

### Role database

- Neon membuat `neondb_owner` dengan **BYPASSRLS**. Karena itu setiap transaksi tenant beralih ke
  role `absah_app` (NOLOGIN, NOBYPASSRLS). Role ini dibuat oleh migrasi `0001_app_role_and_rls.sql`.
- Untuk production disarankan role login terpisah (mis. `absah_api`) yang hanya anggota `absah_app`,
  bukan `neondb_owner`. Migrasi tetap memakai owner lewat `DATABASE_URL_DIRECT`.

## Cloudflare R2 (mulai Fase 2)

Satu bucket privat per lingkungan, location hint `apac`: `absah-dev`, `absah-preview` (bersama,
prefix `pr-<nomor>/`), `absah-staging`, `absah-prod`. Kunci objek `schools/{school_id}/{modul}/{uuid}`.
Akses hanya lewat URL presigned berumur pendek (5 menit).

## GitHub Actions

| Nama | Jenis | Dipakai oleh |
| --- | --- | --- |
| `NEON_API_KEY` | secret | `preview.yml` (buat/hapus branch Neon per PR) |
| `NEON_PROJECT_ID` | variable | `preview.yml`; bila kosong, workflow preview dilewati |

CI utama (`ci.yml`) tidak memakai kredensial nyata: Postgres 18 berjalan sebagai service container.

## absah-app

Variabel frontend didokumentasikan di `docs/environments.md` milik repo absah-app
(`API_URL` untuk rewrite `/api/*` ke server ini).
