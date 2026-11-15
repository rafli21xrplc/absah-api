# Absah — absah-api

School attendance SaaS for Indonesian schools (SD/MI, SMP/MTs, SMA/MA, SMK/MAK).
Multi-tenant: one workspace = one school; workspaces group into collections (yayasan).
Full design: docs/architecture.md. Prompt sequence: docs/prompts.md. Feature codes (e.g. PRS-03, PKL-02) refer to them.

## Two repositories (deviation from docs/architecture.md, which assumes one monorepo)
- absah-api (this repo): apps/server, packages/{db, contracts, capabilities, config}.
- absah-app (github.com/rafli21xrplc/absah-app): apps/web, apps/kiosk, packages/{ui, config}.
- absah-app consumes @absah/contracts and @absah/capabilities from THIS repo as git dependencies
  (github:rafli21xrplc/absah-api#path:/packages/<name>), pinned by its lockfile.
  Therefore those two packages: ship TypeScript source, have no workspace: dependencies, no I/O,
  and no imports of db/express/pg (dependency-cruiser enforces this). A breaking change to them
  needs a matching absah-app PR (`pnpm update @absah/contracts @absah/capabilities` there).
- This repo is PUBLIC. Never commit secrets; .env.local is gitignored.

## Stack
- pnpm workspaces + Turborepo, TypeScript 6 strict (typescript-eslint does not support TS 7 yet).
- apps/server: Express 5. Entrypoints src/entrypoints/http.ts and worker.ts; app factory src/app.ts.
- packages/contracts: Zod 4 schemas per endpoint (component names via .meta({ id })); OpenAPI generated
  into packages/contracts/openapi/openapi.json and served at /api/v1/openapi.json.
- packages/db: Drizzle schema, SQL migrations, RLS policies, seeders, (later) MySQL ETL.
- packages/capabilities: capability catalog + level presets. Pure data, no I/O.
- packages/config: shared tsconfig, eslint, vitest presets.
- Postgres on Neon (Postgres 18; pooled URL for API/worker, direct URL for migrations).
  Jobs: pg-boss (schema pgboss) in the same DB. Auth: Better Auth. Files: Cloudflare R2, presigned only.

## Commands
- pnpm dev                        run server http + worker (tsx watch)
- pnpm turbo lint typecheck test  must pass before you say a task is done
- pnpm depcruise                  architecture rules
- pnpm --filter @absah/db db:generate | db:migrate | db:seed | db:check-rls
- pnpm --filter @absah/contracts openapi   regenerate and commit openapi.json after contract changes
- Integration tests need TEST_DATABASE_URL (local Postgres or docker compose up -d). They fail, not skip, without it.

## Server module layout (apps/server/src/modules/<module>)
domain/ (pure rules, no imports of db/express) -> application/ (use cases) ->
infrastructure/ (Drizzle repos, adapters) -> http/ (routers) -> jobs/ -> index.ts (public API).
Other modules import ONLY from <module>/index.ts. Cross-module side effects go through outbox events.

## Database roles and RLS (how isolation actually works here)
- Neon's login role (neondb_owner) HAS BYPASSRLS. Isolation therefore relies on withTenant switching
  to role absah_app (NOLOGIN, NOBYPASSRLS) with set_config('role', ..., true) inside the transaction,
  plus app.school_id / app.user_id. Never remove that switch; never grant BYPASSRLS to absah_app.
- New tables get SELECT/INSERT/UPDATE/DELETE for absah_app via default privileges (migration 0001).
  Tables in a new schema (e.g. tppk) need explicit GRANTs in their migration.
- RLS policies live in SQL migrations (drizzle-kit generate --custom). db:check-rls verifies them.
- New policies use nullif(current_setting('app.school_id', true), '')::uuid so an unset value matches nothing.
- withUser(userId, fn) is the ONLY exception to "always withTenant": cross-school reads for one user
  before a school is chosen (memberships and their schools for /me/context). RLS limits it to the
  user's own memberships. Do not use it for anything else.
- absah_app has no access to Better Auth tables (user, session, account, verification, two_factor,
  rate_limit). Names of a school's members come from the view school_member_directory.

## Auth and request context (apps/server/src/modules/platform)
- Better Auth at /api/auth/* (mounted before express.json). No public sign-up: accounts are created
  with createStaffUser / createPhoneUser (invitations in prompt 1.5). Staff: email + password.
  Parents and industry supervisors: WhatsApp OTP, only for phone numbers already on an account (E.164 +62).
- Phone-only users get a placeholder email <digits>@phone.absah.invalid; never show or mail it.
- resolveContext(auth, { school: 'required' | 'optional' }) fills req.ctx; X-School-Id must match an
  ACTIVE membership (else 403, same answer for unknown schools). Admin/operator without TOTP get
  403 TWO_FACTOR_REQUIRED once a school is selected.
- Authorization lives in use cases: authorize(actor, policy) with policies in <module>/domain/policies.ts
  built from shared/policy.ts (pure; domain/ may import it). Routes only call getActor(req).
- Better Auth's internalAdapter.createUser drops plugin fields (phoneNumber); set them with updateUser.

## Non-negotiable rules
1. Every tenant table has school_id uuid not null, an index starting with school_id, and an RLS policy.
   Never add BYPASSRLS, never query outside withTenant(ctx, fn). Run db:check-rls after migrations.
2. Every write endpoint accepts Idempotency-Key. Kiosk, PKL check-in and payment endpoints require it.
3. Never call WhatsApp, payment or email from a request handler. Write an outbox event in the same
   transaction; the worker performs the side effect.
4. Never branch on school level (no if level === 'sd'). Read capabilities from req.ctx.caps and
   guard routes with requireCap(key). Level only sets capability defaults in packages/capabilities.
5. One session engine: class, daily (SD), activity and PKL attendance all use attendance_sessions
   and attendance_records with a mode. Do not create parallel attendance tables.
6. Validate every request and response with the Zod contract from packages/contracts (sendContract).
7. No any, no ts-ignore, no disabled tests to make CI green. If blocked, stop and explain.
8. Dates: timestamptz in UTC; school_date computed in the school timezone (default Asia/Jakarta).
9. Personal data: no names, phone numbers or NISN in logs (shared/logger.ts REDACT_PATHS + serializeErr,
   which drops SQL parameters and quoted values from DB errors). Sensitive text columns (TPPK, BK, UKS
   notes, pickup phone, NIK) use encryptedText(name, '<table>.<column>') from @absah/db.
10. The tppk schema is readable only by TPPK members; support access never includes it.

## Encryption and audit (PLT-04, PLT-05)
- encryptedText columns read as SensitiveText: it prints "[redacted]" in JSON/logs; call .reveal() only
  where the plaintext is really needed (e.g. building a response the caller may see). Write with
  sensitive(value). The context string is the AAD: never rename it once data exists.
- Keys: ENCRYPTION_KEYS "<id>:<base64 32B>,..." + ENCRYPTION_ACTIVE_KEY_ID. To rotate: add a new key,
  make it active, re-encrypt rows with rotate() (job, later), then remove the old key.
- Values matched but never read back (IP, tracking codes) use hashValue() (HMAC with HASH_KEY).
- Every state-changing use case calls audit(tx, auditContext(req, actor), 'entity.verb', {type, id},
  {before, after}) inside the same withTenant transaction. Diffs are sanitised (sensitive keys and
  SensitiveText redacted, size capped); still pass only the fields that changed.
- audit_logs is append-only (no UPDATE/DELETE for absah_app) and readable only by active admins.
  Never use .returning() on it. Anonymous TPPK flows pass { omitIp: true }.
- Test phone numbers/emails must be unique per run (testPhone(), uuid emails) so reruns never collide.

## Testing expectations
- Domain rules: Vitest unit tests next to the code.
- Repositories and RLS: integration tests against Postgres (TEST_DATABASE_URL).
- Every new endpoint: Supertest test for happy path, validation error, wrong role,
  capability disabled, and idempotent replay.
- Jobs: test with real pg-boss, school timezone and retries.

## Working style
- Before writing code, post a short plan: files to add/change, migrations, endpoints, tests.
- Work in vertical slices: migration -> domain -> use case -> contract -> route -> tests (UI in absah-app).
- Keep PRs under ~600 changed lines excluding generated files; split otherwise.
- When a requirement is ambiguous, check docs/architecture.md first, then ask.
- UI and error message copy is Indonesian, short and plain. Code, comments, commits in English.

## Glossary
rombel = class group; wali kelas = homeroom teacher; guru mapel = subject teacher;
piket = duty teacher; S/I/A = sakit/izin/alpa (sick/excused/absent), H = hadir, T = terlambat;
izin = leave request; TPPK = school anti-violence team; UKS = school clinic;
PKL = industry internship (SMK); DUDI = industry partner; pembimbing = supervisor;
7 KAIH = seven habits journal; MBG = free school meal program, PIC MBG = meal coordinator;
Dapodik / EMIS = national student databases (MoE / Ministry of Religious Affairs);
e-Rapor / RDM = report-card systems (MoE / madrasah); yayasan = foundation owning schools.
