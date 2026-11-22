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
- withPlatform(fn) runs as the login role with no RLS scoping. Only for platform tables and
  cross-school maintenance jobs (idempotency cleanup, outbox relay, webhook inbox). Never in request
  handling of tenant data; every call site says why.
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
- New schools: `pnpm --filter @absah/server school:create --name ... --admin-name ... --admin-email ...`
- Sessions now (ops, e2e): `pnpm --filter @absah/server attendance:generate --school <id> [--date YYYY-MM-DD] [--force]`
  (--force: also on non-school days and again after a timetable change; existing sessions kept).
  (ops) creates the school and invites its first admin; the admin runs the setup wizard.
- Invitations (POST /school/invitations, admin): staff by email (password) or WhatsApp (OTP). The
  token is "<schoolId>.<secret>" (only an HMAC stored, 7 days, single use) so preview/accept run in
  withTenant(schoolId) without bypassing RLS. Links use a #fragment and tokens travel in request
  bodies, never in paths. Delivery over WhatsApp/email arrives in 3.2 (event membership.invited).

## Non-negotiable rules
1. Every tenant table has school_id uuid not null, an index starting with school_id, and an RLS policy.
   Never add BYPASSRLS, never query outside withTenant(ctx, fn). Run db:check-rls after migrations.
2. Every write endpoint accepts Idempotency-Key. Kiosk, PKL check-in and payment endpoints require it.
   Mount idempotent() (shared/idempotency.ts) after resolveContext({ school: 'required' }). It stores
   responses < 500 for 24 h (encrypted), replays them with Idempotent-Replayed: true, 422 on a reused
   key with another body, 409 while the first is running; a 5xx frees the key. If the process dies
   between commit and storing the response, a retry can run again after 60 s: keep use cases
   naturally idempotent too (state checks, unique constraints).
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

## Capabilities (PLT-07, AKD-08)
- Catalog, level presets and resolveCapabilities() live in packages/capabilities (pure, shared with
  absah-app). Order: catalog default < LEVEL_PRESETS[level] < MADRASAH_OVERLAY < school_capabilities
  override < platform_flags kill switch. New keys get a safe default in the catalog.
- resolveContext fills req.ctx.caps once per request (empty without a school); /me/context sends it
  to the web. Guard routes with requireCap('<bool key>') after resolveContext({ school: 'required' }):
  disabled answers 404 CAPABILITY_DISABLED. Enum capabilities are read from req.ctx.caps in use cases.
- school_capabilities: one row per (school, key). Deferred keys (DEFERRED_CAPABILITIES, today only
  attendance.mode) keep previous_value until effective_from (tomorrow, school timezone) once the
  school finished setup (before that no sessions exist, so changes apply at once); a null value
  means "back to the preset". Stored values the catalog rejects are ignored with a warning.
- Settings endpoints (modules/academic, admin only, idempotent, audited): PATCH /school/profile
  (re-applies presets, keeps overrides, pins attendance.mode until tomorrow when the preset would
  switch it), GET|PUT /school/capabilities (PUT is partial; null = back to preset; keys under a
  kill switch -> 409 CONFLICT).
- platform_flags (kill switches) are set by the Absah team with the owner role, e.g.
  insert into platform_flags (id, key, value, school_id, reason) values (gen_random_uuid(),
  'pkl.enabled', 'false', null, 'incident #12'); a per-school row beats the global row. The app role
  can only read global rows and its own school's.

## Academic data (AKD, packages/db/src/schema/academic.ts)
- academic_years (one active per school), semesters (1, 2), calendar_days (exceptions only:
  holiday or extra school_day), classes (rombel: grade 1-13, stream for SMA/MA), students,
  enrollments (student x class x year; one active per year; missing_since = "calon keluar"),
  guardians + student_guardians, consents. All tenant tables with RLS; TRUNCATE revoked.
- students.nik and guardians.phone are encryptedText; match them through nik_hash / phone_hash
  (hashValue). Never select NIK into list responses.
- Enum values live in packages/contracts/src/academic/enums.ts and feed the pgEnums.
- memberships live in schema/memberships.ts (FK to academic_years) to avoid an import cycle.
- Student import: importers implement StudentImporter (domain/student-import.ts) and live in
  infrastructure/importers/<source>; importerFor(source) picks one. Parsers read only the columns
  Absah needs. Matching is pure (domain/student-matching.ts): NISN, then NIK hash, then name +
  birth date; blanks never erase stored values; students missing from the file are "calon keluar".
- EMIS (AKD-09): POST /imports/emis (requireCapValue data.source emis, madrasah preset) with the same
  parse/preview/commit; EmisImporter (infrastructure/importers/emis) reads one header row. Both importers
  share importers/student-sheet.ts (firstSheet, readStudentRows). EMIS columns are TODO(pilot)
  (packages/db/fixtures/emis/README.md, emisFixture('data-siswa.xlsx'), fixtures:emis).
- Import flow: POST /imports/dapodik (presigned PUT, key from the actor's school) -> browser PUTs
  the file -> POST /imports/{id}/parse emits student_import.uploaded -> consumer
  academic_parse_student_import (worker) parses and stores the preview -> GET /imports/{id}.
  student_imports.preview is one encrypted JSON document (rows incl. NIK + preview lines); counts
  are plain. A bad file sets status failed with a message for staff; other errors retry.
- Commit (POST /imports/{id}/commit, application/commit-student-import.ts): one transaction under a
  per-school advisory lock; re-plans and compares the fingerprint (mismatch = 409 stale_preview,
  nothing written; refresh with POST /parse). Creates the active year (+ semesters) and rombel when
  needed; class moves close the old enrollment as class_changed and open a new one; missing
  students get enrollments.missing_since; matched ones have it cleared. After commit the preview
  keeps no NIK and the file is removed. Job academic.import_retention (02:45) expires uncommitted
  imports after 7 days.
- Registry reads: GET /students (cursor = base64url [name, id], status active|missing|all, q on
  name/NISN/NIPD), GET /classes (active year, counts, homeroom name via school_member_directory),
  PATCH /enrollments/{id} settles calon keluar (active keeps; moved/left ends the enrollment).
  Readers: admin, operator, kepsek, wakasek (canReadStudentData); writers: admin, operator.
- Test files: anonymous Dapodik exports in packages/db/fixtures/dapodik (generate.ts, fake NIK
  region 990101); import them with dapodikFixture() from '@absah/db/fixtures'. Never real data.

## Schedule (AKD-05, AKD-10, packages/db/src/schema/schedule.ts)
- subjects; schedule_periods (school, ISO day 1-7, jam ke-n, start/end) - slots refer to
  (day, period number), not to a period row; schedule_slots (academic year, owner_type class|group
  + owner_id, day, period, subject, teacher); learning_groups + learning_group_members (enrollment).
- DB guarantees: one slot per owner per time; a teacher once per time (unique index, teacher not
  null). Students in two slots at once (rombel + group, or two groups) are checked in the app.
- Conflict logic is pure: findScheduleConflicts (domain/schedule-conflicts.ts) over any set of
  slots + a studentsOf lookup; every schedule write runs under lockSchedule (per-school advisory
  lock) and answers 409 SCHEDULE_CONFLICT with details.conflicts (ScheduleConflictDetail[]).
- Managers: admin, operator, wakasek (canManageSchedule); readers add kepsek, wali_kelas, guru,
  piket. Teachers must be active staff (school_member_directory). Jam pelajaran cannot be removed
  while lessons use them.
- Learning groups (routes behind requireCap('attendance.learningGroups')): members are active
  enrollments; replacing members re-checks student clashes at the group's lesson times.
- Template import (application/schedule-import.ts): GET /schedule/template.xlsx (sheet Jadwal:
  Rombel | Hari | Jam ke | Mapel | Guru, prefilled + reference sheets), presigned upload under
  schools/{id}/schedule_imports/{uploadId}, stateless preview (planScheduleImport, per-row errors,
  fingerprint) and commit (re-plan under lock, 409 stale_preview / has_errors; replaces every
  lesson of the rombel in the file, creates missing subjects, deletes the file).

## Attendance (PRS, modules/attendance, packages/db/src/schema/attendance.ts)
- attendance_sessions (school_date, mode per_period|daily|activity|pkl, owner_type
  class|group|activity|placement + owner_id, slot_id, teacher_id, status open|submitted|missed|locked),
  attendance_marks (one row per session x enrollment x source: that source's latest word),
  attendance_records (one row per session x enrollment: the winning mark),
  daily_attendance (one row per enrollment per school date), correction_requests,
  attendance_days (per school date: generated_at / skipped_reason / locked_at, the job markers).
- Source priority (domain/status-rules.ts SOURCE_PRIORITY): manual > leave > uks > pkl_confirm >
  teacher > gate. Statuses change ONLY through changeMarks (application/marks.ts): write or remove
  marks (removeRef drops every mark of one source_ref, e.g. a cancelled izin), re-resolve records
  (resolveMarks), recompute daily_attendance, emit attendance.absent_marked on a change to A.
  Removing the winner brings the next source back; no mark left = no record.
- computeDailyStatus: present in any session -> H (T if any T); absent all day -> most frequent of
  S/I/A, ties S > I > A. isSchoolDay: calendar_days first, then weekdays with jam pelajaran, else Mon-Fri.
- Jobs (jobs/session-jobs.ts) prs.generate-sessions / prs.remind-unfilled / prs.lock-sessions run
  every 5 minutes (UTC cron) for every school and act on the school's own clock (schoolMinutes):
  generate from 05.00 (daily: one session per rombel owned by the wali kelas; per_period: one per
  slot of the weekday), remind 10 min after the lesson (daily: 10.00) via attendance.session_unfilled,
  lock at 23.59 or later (catch-up): open -> missed, others locked, recomputeDaily, one
  attendance.session_locked per day. attendance_days rows make each step idempotent.
- Filling (application/sessions.ts): GET /attendance/today?scope=mine|all, GET /sessions/{id},
  POST /sessions/{id}/submit with exceptions only (rest H, source teacher, never over higher
  sources: those students come back fixed=true). Teacher, wali kelas (daily) or admin/operator/
  wakasek/piket may fill (domain/policies.ts). Locked -> 409 SESSION_LOCKED. Unchanged rows are not
  rewritten, so attendance.absent_marked fires only on a change to A. "Today" uses the school timezone.
- Corrections (PRS-05, application/corrections.ts): POST /sessions/{id}/corrections (locked
  sessions only, one pending per student), GET /corrections (wakasek/kepsek all, others own),
  POST /corrections/{id}/decide (wakasek/kepsek, never their own request). Approval writes
  source manual (final), recomputes the day, audits attendance.corrected.
- Izin (application/leave-marks.ts): consumers attendance_apply_leave (leave.approved) and
  attendance_revoke_leave (leave.cancelled) both run syncLeaveMarks: re-read the request and make
  its leave marks match (approved -> S/I in every covered class/group session, else none), so
  order and redelivery do not matter. generateForSchool calls applyLeavesToDate after inserting
  sessions, so izin approved earlier fill sessions created later. Locked sessions are included
  (a sick note arriving the next day is normal); backdating is capped at 7 days by the leave module.

- Jam siswa (AKD-10, application/student-hours.ts): GET /classes/{classId}/student-hours?date (default today)
  for the rombel's wali kelas and canSeeAllSessions; others 404. Sessions = the rombel's own plus those of
  learning groups with any of its active students (listSessions forClass), activities excluded; per
  student only the sessions they belong to, with the record status and daily_attendance. Group session
  records count in the student's own rombel rekap (daily_attendance is per enrollment).
- Jurnal mengajar (PRS-09, application/journal.ts): POST /sessions/{id}/submit takes an optional `topic`
  (max 200, trimmed; omitted keeps it, empty clears it; per_period sessions only, else 400). It is also on
  SessionSummary.topic. GET /teaching-journal?month=YYYY-MM[&teacherId] lists per_period sessions of the
  month (topic null = not written yet) with totals; a guru sees only their own, admin/kepsek/wakasek any
  teacher or all (canReadAllJournals). GET /teaching-journal/export.xlsx is one teacher-month built
  synchronously (small), teacherId required for managers.

## Leave (IZN, modules/leave, packages/db/src/schema/leave.ts)
- leave_requests (enrollment, kind sakit|izin, starts_on..ends_on inclusive, reason encryptedText,
  attachment_key/type, status pending|approved|rejected|cancelled, requested/decided/cancelled by+at).
- Who: a parent (role orang_tua whose guardians.user_id is linked to the student) requests -> pending;
  the wali kelas of the student's rombel (or wakasek/kepsek) decides, and when they enter it
  themselves (phone call, letter) it is approved at once. Requester or decider may cancel a pending
  or approved request. At most 30 days, starting at most 7 days back (school timezone); one izin per
  student per day (advisory lock per enrollment + overlap check, 409 overlap).
- Events {leaveRequestId}: leave.requested, leave.approved, leave.rejected, leave.cancelled (only
  when it was approved). Attendance turns approved ones into marks (application/leave-marks.ts); notify sends WhatsApp (3.2).
- Attachments: POST /leave-requests/attachments presigns schools/{id}/leave/{uuid}; create checks the
  object exists; GET /leave-requests/{id}/attachment returns a 5-minute presigned GET (inline, the
  stored content type). Portal action links (3.3) will call createLeave / cancelLeave from index.ts.

## Gate (GRB, modules/gate, packages/db/src/schema/gate.ts)
- Tables: gate_secrets (per-school card secret, encryptedText, never leaves the server), cards
  (one per student, active_device_id = the bound phone), card_devices (bind history), kiosk_devices
  (token hash, heartbeat fields), kiosk_pairings (one-time codes), gate_scans (append-only log of
  every kiosk scan and piket manual entry: accepted | duplicate | rejected + reason; unique
  (kiosk, client_event_id); one accepted arrival per student per school date). students.user_id
  links the PWA siswa account (3.3).
- Card tokens (@absah/contracts gate/card-token.ts, shared with kiosk and portal): A1.<card+device
  ids>.<30 s window>.<HMAC>. schoolDayKey = HMAC(secret, date) goes to kiosks (offline checks),
  deviceDayKey = HMAC(dayKey, deviceId) only to the bound phone, so tokens for another device id
  cannot be made; +-2 windows of clock skew. Never change the format without a new prefix.
- Kiosks (application/kiosks.ts): admin/operator POST /gate/kiosks/pairings -> code
  "<schoolId>.<secret>" (10 min, single use, shown as QR + text); the kiosk POST /kiosk/pair gets
  a device token "<schoolId>.<kioskId>.<secret>" (hash stored) and sends `Authorization: Kiosk
  <token>`. The kiosk app is a static export on its own origin: /api/v1/kiosk/* allows CORS for
  KIOSK_ORIGINS only (no cookies, kioskCors). kioskContext() authenticates and requires gate.enabled; kiosk Idempotency-Keys are
  scoped to the device (kioskIdempotencyScope; idempotent(scopeOf) takes any scope). Heartbeat
  every minute (queue size, version); online = heartbeat < 150 s. Revoke = 401 at once.
- Cards (application/cards.ts): holder from card.holder (student: students.user_id; parent:
  guardians.user_id). POST /cards/devices binds the caller's phone (previous phone revoked) and
  returns 7 days of device keys; GET /cards/devices/{id}/keys refreshes them while still bound.
- Scans (application/scans.ts): GET /kiosk/day (day keys today+tomorrow, lateAfter, bound cards
  with first name + rombel only); POST /kiosk/scans (<= 200 per batch, one transaction). Per scan:
  stored answer for a known (kiosk, client_event_id) -> verifyCardToken at scannedAt (more than
  5 min ahead = expired) -> card -> active device -> active enrollment -> first accepted arrival
  of the day (unique index decides races) else duplicate. Accepted arrivals call attendance
  applyGateArrivals (source gate: daily H or T after schoolStartTime = first jam pelajaran else
  07.00; lessons H before, T during, none after); generateForSchool re-applies arrivals of the day.
- Piket (application/arrivals.ts): POST /gate/arrivals (piket/admin/operator/wakasek; reason
  required; today, not in the future; gate_scans method manual + recorded_by; 409 already_arrived;
  audited gate.manual_arrival) and GET /gate/today (late arrivals, not-arrived list with approved
  izin flagged S/I so piket does not chase them; reads leave_requests directly).
- Load: test/kiosk-load.test.ts (900 scans, 3 kiosks, resent batches, CI) and
  load/kiosk-scans.k6.js with `gate:load-fixture --school <id>` (dev/staging only).

- Buku tamu (GRB-11, behind gate.visitors; application/visitors.ts, table visitors): the kiosk calls
  GET /kiosk/visitor-hosts (active staff, id + name) and POST /kiosk/visitors { clientEventId, name,
  organization?, purpose, hostUserId? }; unique (school, client_event_id) makes a resend return the stored
  visit. Naming a host emits gate.visitor_arrived { visitorId, hostUserId } (no consumer until the staff
  push of NTF-06, prompt 5.7). Piket/admin/operator/wakasek PATCH /visitors/{id}/leave (idempotent, audited
  gate.visitor_left; a second call changes nothing); GET /visitors?date&status=inside|all also for kepsek.
  Photo: POST /kiosk/visitor-photos (JPEG <= 2 MB, presigned PUT under schools/{id}/visitors/{uuid}; the key
  comes from the kiosk's school) -> photoId in POST /kiosk/visitors (400 photoId when not uploaded);
  GET /visitors/{id}/photo gives a 5-minute link and is audited (gate.visitor_photo_viewed). Job
  gate.visitor_photos (02:55) removes the file and sets photo_removed_at 30 days after left_at, or after
  arrived_at when nobody signed the guest out. The R2 bucket CORS must allow PUT from KIOSK_ORIGINS; in dev/tests the filesystem stand-in
  (/api/v1/storage/fs) gets the same kioskCors middleware (GET, POST, PUT).
- Penjemput resmi (GRB-09, behind gate.pickup; http/pickup.ts, application/pickup-guardians.ts, table
  pickup_guardians, migrations 0059-0060): name, relation (pickup_relation enum), phone encryptedText
  (masked in responses, never audited), photo_key (required, schools/{id}/pickup/{uuid}), valid_until,
  status pending|approved|rejected|inactive, decided_by/at, ended_at, photo_removed_at. Who: the
  student's parent (guardians.user_id), their wali kelas (homeroom of the active rombel) or admin;
  anyone else 404. A parent's entry is pending, a wali kelas/admin entry approved at once; at most 6
  pending+approved per student (409 too_many). POST /pickup-guardians/{id}/approve|reject (wali kelas,
  admin; pending only) and /deactivate (also the parent); repeating is a no-op, other moves 409;
  audited gate.pickup_guardian_<status>. GET /pickup-guardians?status (admin: all, others: own rombel as
  wali kelas). Piket also reads a student's list and opens photos; GET /pickup-guardians/{id}/photo is
  for wali kelas, piket, admin (5-minute link, audited gate.pickup_photo_viewed). Job gate.pickup_photos
  (02:50) removes photos 30 days after ended_at.
- Check-out (GRB-10; application/checkouts.ts, table pickup_events, migrations 0061-0062): GET /kiosk/day
  carries pickup (null without gate.pickup): approved, still-valid penjemput per cardId with 5-minute
  photo links the kiosk downloads at once. POST /kiosk/checkouts (gate.pickup) { checkouts: [{
  clientEventId, token, pickupGuardianId, checkedOutAt }] }: card checked like a scan (verifyCardAt),
  then the penjemput must belong to the student, have been approved (decided_at; status approved or
  inactive: deactivated after the morning sync still counts) and be valid that date, else
  not_authorized (not stored). Unique (school, client_event_id) + partial unique released per
  enrollment per day: a second release is duplicate. Each release emits gate.checked_out; consumer
  notify_checked_out sends student_picked_up (pending approval) with pickup_name and time. pickup_name
  is the name at the time.
- Unlisted penjemput (GRB-10; application/unlisted-pickups.ts, online only): POST /kiosk/pickup-photos
  (presigned PUT) then POST /kiosk/unlisted-pickups { clientEventId, token, name, photoId, requestedAt }
  -> pickup_events status held with unlisted_photo_key (400 unreadable card / photo not uploaded; 409
  already_released), emits gate.unlisted_pickup -> notify_unlisted_pickup sends unlisted_pickup
  (pending approval) with each parent's action link. The kiosk polls GET /kiosk/unlisted-pickups/{id}.
  decideHeldPickup (shared): allow -> released + checked_out_at + gate.checked_out (parents then get
  student_picked_up); deny -> denied; same decision again no-op; otherwise 409 decided / expired (past
  school date) / already_released. Deciders: the parent through POST /links/pickups/{id} { decision }
  (not the link's one write; GET /links/pickups/{id}/photo lets them see who is at the gate, audited),
  or the student's wali kelas / admin via POST /pickups/{id}/allow|deny. GET /pickups?date: gate
  viewers (canSeeGateToday) all, anyone else their own rombel as wali kelas; held first.
  GET /pickups/{id}/photo: wali kelas, piket, admin (audited gate.unlisted_photo_viewed). The link
  context carries today's unlisted requests (pickups). Job gate.pickup_photos also expires held rows
  of past school dates (each school's timezone) and removes unlisted photos 30 days after the request.

## Notifications (NTF, modules/notify, packages/db/src/schema/notify.ts)
- message_templates: platform rows (code, language, body with {{name}} placeholders, params order,
  provider_name, approval draft|pending|approved|rejected); the app role only reads them, the Absah
  team updates approval with the owner role once the provider approves a template.
- notifications: one message to one recipient; unique (school_id, dedup_key); to_phone and params
  encryptedText; status queued -> sent -> delivered -> read, or failed (NOTIFICATION_STATUS_RANK:
  a lower rank never overwrites a higher one).
- Senders (shared/messaging): MessageSender.sendTemplate / sendOtp; FakeMessageSender (dev/test,
  in memory, dev logs at debug) and MetaCloudSender (WhatsApp Cloud API). WHATSAPP_PROVIDER picks
  one; production requires meta_cloud with WHATSAPP_* credentials from env only. SendError.retryable
  separates network/429/5xx from final errors. Never log phone numbers or message text.
- Flow (modules/notify): consumers notify_absent_marked (attendance.absent_marked), notify_leave_approved
  and notify_leave_rejected read the student and the guardians with a phone, then queueMessages:
  one row per guardian with a dedup key (absent:<enrollment>:<date>:<guardian> = one alpa message
  per day; <event>:<leave>:<guardian>), params = school, first name, status words, link. Due rows
  get released_at + event notification.queued at once; quiet hours (21.00-06.00 school time,
  releaseTime) leave them for job notify.release (every minute, withPlatform only to list schools).
- notify_send (notification.queued, retryLimit 2 = 3 attempts) locks the row, skips anything not
  queued, refuses unapproved templates on real providers (template_not_approved), sends, marks sent.
  Retryable SendError throws until the last attempt (Delivery.lastAttempt from pg-boss retryCount),
  then failed with the error code. A crash between provider and commit can resend (at least once).
- Status webhooks: GET/POST /api/v1/webhooks/whatsapp (mounted before express.json, signature
  X-Hub-Signature-256 over the raw body with WHATSAPP_APP_SECRET; GET echoes hub.challenge for
  WHATSAPP_VERIFY_TOKEN; no secrets configured = 404). parseMetaStatuses -> recordWebhook('whatsapp',
  '<wamid>:<status>') -> job notify.webhooks (every minute) applies them: withPlatform only to read
  the inbox and find the message's school, then withTenant. nextStatus ranks (read > delivered >
  failed > sent); each status keeps its own timestamp; last_error only while failed. Unknown ids wait
  (send may still be committing) and are dropped after a day.
- Dashboard: GET /notifications/overview (admin, operator): today's counts by status, failures of the
  last 7 days with masked number (maskPhone) and first name.
- Each queued message mints its own action link per guardian (shared/action-links.ts, only for
  dedup keys not used yet) and passes it as the `link` param: `${appUrl}/t#<schoolId>.<secret>` (fragment: never in a web server log).
- Consumers get (tx, event, delivery); Consumer.retryLimit overrides the queue's retry policy.
- Links point to /portal until prompt 3.3 adds tokenized action links. Staff (wali kelas, teacher
  reminders) get push in NTF-06 (prompt 5.7): their phone numbers live in Better Auth tables.
- Preferences (ORT-06, notification_preferences, migrations 0073-0074): one row per guardian (guardians are
  per school; no row = defaults), muted_types text[] + no_late_messages. GET|PUT /portal/notification-preferences
  (orang_tua only, own rows by guardians.user_id, PUT idempotent and audited without the number; the PUT writes
  every guardian row the account owns at that school). Only MUTABLE_TEMPLATE_CODES (contracts notify/enums.ts:
  alpa, izin decisions, sent home, picked up, buku penghubung) can be switched off; unlisted_pickup, OTP and
  TPPK always arrive, enforced in the API contract AND in isMuted (domain/preferences.ts) against stale rows.
  queueMessages is the one place that applies them: a muted type creates no row (dedup key stays free), and
  "no late messages" ends that guardian's window at 19.00 school time (windowFor, NOTIFICATION_LATE_CUTOFF_MINUTES),
  so a later message waits for 06.00 like the quiet hours. Recipients without a guardianId (PIC MBG) are unaffected.
- Web Push for staff (NTF-06, migrations 0075-0076; 5.7d): off unless VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and
  VAPID_SUBJECT are all set (`npx web-push generate-vapid-keys`; the private key only in env). GET /push/config
  answers { publicKey | null }. PUT /push/subscriptions { endpoint, keys } and POST /push/subscriptions/remove
  (school staff only: not parents, siswa or pembimbing_industri; idempotent, audited WITHOUT the endpoint) keep
  push_subscriptions per (school, user, endpoint_hash): endpoint, p256dh and auth are encryptedText because the
  endpoint is a credential. At most PUSH_MAX_PER_USER (10) per member and school, oldest dropped. A member enables
  it once per school. RLS is stricter than usual: inside a request a member sees only their own rows, consumers
  (user null) read per school. Sending: shared/push PushSender (FakePushSender in tests, WebPushSender = web-push
  3.6.7, pinned on purpose; 4.0.0 was 2 weeks old) and notify's pushToUser(tx, sender, userId, message): drops
  devices answering 404/410, succeeds when one device accepted, throws a retryable PushError only when none did.
  A PushMessage shows on a lock screen: never a name or any personal data, only "Ada tamu menunggu di gerbang"
  style text plus a path; `tag` collapses repeats.
- Push consumers (5.7e, application/push-consumers.ts, registered in the worker only when VAPID is set):
  notify_push_visitor_arrived (gate.visitor_arrived -> the named host, "Ada tamu menunggu Anda di gerbang."),
  notify_push_session_unfilled (attendance.session_unfilled -> teacherId, link /sesi/<id>), notify_push_leave_requested
  (leave.requested -> wali kelas of the student's rombel, only while pending and not made by that wali kelas;
  tag leave-approval so several requests are one notification, link /izin). Titles are the school name; no student
  name, number or reason ever (a test checks). A member without a device gets nothing and no error. Other
  "antrean persetujuan" (pickup guardians, corrections) have no event yet: add one when they need push.
- Exception to rule 3: the login OTP is sent inline from Better Auth's sendOTP (user waiting, no
  school for a tenant outbox, route rate limited). Everything else goes through the worker.

## File storage (apps/server/src/shared/storage)
- ObjectStorage interface: presignUpload (5-minute PUT, Content-Type and Content-Length signed),
  presignDownload (5-minute inline GET with a fixed content type), read, remove. R2ObjectStorage in
  production (STORAGE_DRIVER=r2 is enforced), FsObjectStorage in
  dev/test with an HMAC-signed PUT /api/v1/storage/fs/... route that mimics R2.
- Keys are always storageKey(schoolId, module, uuid) = schools/{school_id}/{module}/{uuid}; build
  them from the actor's school, never from client input.
- Browsers upload directly to the presigned URL; handlers never stream file bodies.
- write(key, body, type) is for files the worker makes (exports) only. presignDownload({ fileName })
  answers Content-Disposition attachment (saved file) instead of inline.

## Outbox, consumers and inbox (PLT-13, apps/server/src/shared/outbox)
- emit(tx, type, payload) inside the use case's withTenant transaction, next to audit(). The school
  comes from the transaction; the request id becomes trace_id. Event types and payload schemas live
  in shared/outbox/events.ts: ids and states only, no personal data. Never change a payload shape;
  add a new type.
- The worker relay moves unpublished events to pg-boss (one queue per consumer:
  evt.<type>.<consumer>) and marks published_at in the same transaction (FOR UPDATE SKIP LOCKED).
- Consumers: defineConsumer({ name, event, handle(tx, event) }) and add it to the worker's list.
  handle runs in withTenant(event.schoolId, user null) together with an outbox_consumptions mark,
  so redeliveries are skipped. External calls in a handler must be idempotent per event.id.
  Queue policy: 5 retries with backoff, then outbox.dead.
- The app role can only INSERT outbox_events (no read back, no .returning()).
- Incoming webhooks: recordWebhook(provider, externalId, payload) (dedup on the provider id), process
  in a job, then markWebhookProcessed(id). inbox_webhooks is a platform table (withPlatform only).

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

## Action links (modules/portal, ORT-01)
- Token "<schoolId>.<secret>" minted by notify through shared/action-links.ts (notify depends on no
  module); only HMAC(`action-link:<secret>`) is stored in action_links (tenant table, RLS). 7 days.
- The web page /t (token in the fragment) calls GET /links/context, POST /links/leave, POST /links/card with
  `Authorization: Link <token>` (never the token in an API URL). Unknown 401, expired 410 LINK_EXPIRED.
- One write per link: POST /links/leave locks the link row, creates a pending izin through
  leave.requestLeaveAsGuardian (requested_by null, requested_by_guardian_id set) and spends the
  link in the same transaction; 400s do not spend it. Reads (context, card) stay usable for 7 days.
- Card: gate.linkCardKeys keeps the link's own device (holder parent, user_id null); a card active
  on another phone answers 409 bound_elsewhere unless `replace`.
- Context shows the first name only (links get forwarded); no reason, no phone, no full name.
- e2e reads a link with the dev CLI `notify:last-link --school <id>` (refuses production) and a login
  code with `auth:last-otp --phone <E.164>` (platform lastPhoneOtp reads Better Auth's verification
  row through withPlatform; refuses production).

## Portal logins and contacts (ORT-02)
- PUT /students/{id}/contacts (admin, operator, the student's wali kelas; others 404): guardian
  numbers (guardians.phone encrypted + phone_hash) and the student's login number. The login is
  created through Better Auth first (own connection), then the tenant transaction links
  students.user_id and sets an active `siswa` membership (platform.setPortalMembership; no
  invitation, the OTP is the proof). null suspends it. A number owned by another account → 409
  phone_taken. Audit records which numbers changed, never the numbers; responses mask them.
- Parent logins: guardians[].portal on the same PUT (phone optional = unchanged). portal true needs
  a number (400 otherwise) and links guardians.user_id to the account that OWNS the number
  (platform.guardianLogin: reused, so siblings and other schools share one login) plus an active
  orang_tua membership; a student's own login is refused (409 phone_student). portal false or a
  null number unlinks; the membership is suspended only when no other guardian row of the school
  still uses that account. Audit after.guardianPortal [{guardianId, portal on|off}].
- GET /portal/attendance: siswa → own student (students.user_id), orang_tua → children; today plus
  the last 30 days of daily_attendance with counts.
- Parent with children at several schools (ORT-03/04, 5.7b): ONE login. /me/context lists every school with an
  active membership (orang_tua at each, since guardianLogin reuses the account that owns the number), and the
  portal never reads across schools: each call carries X-School-Id and RLS decides, so the web composes the
  children of all schools (one /portal/attendance per school with the orang_tua role). Do not add a
  cross-school query for this (withUser is for memberships only). Preferences are per school too.
  /portal/attendance?days=1..180 (default 30) and ?studentId= (one child; a stranger's id gives an empty
  list) serve ORT-05; items carry enrollmentId, the key of the child's izin in GET /leave-requests (parents
  already read their children's). Poin and tagihan history arrive with 5.8 / 5.10 behind their capabilities
  (neither module exists yet).

## Activity (KEG, modules/activity, packages/db/src/schema/activity.ts)
- activities (per academic year: name unique, kind ekskul|upacara|ibadah|lainnya, location
  sekolah|luar_sekolah, days smallint[] ISO weekdays, optional starts_on/ends_on, active),
  activity_coaches (pembina = any active staff, not the membership role), activity_members (active
  enrollments of that year). Migrations 0050-0051; attendance_sessions.activity_id now has an FK
  (on delete restrict: deactivate activities, never delete them).
- KEG-03: kind ibadah (sholat berjamaah) needs religious.worship (madrasah preset); POST/PATCH with
  kind ibadah answer 404 CAPABILITY_DISABLED otherwise (checkKind in http/activities.ts).
- GET /activities (admin, operator, wakasek, kepsek: all; others: the ones they coach), POST and PATCH
  (admin, wakasek; coaches replaced as a whole), GET /activities/{id}, GET|PUT .../members (managers or
  coaches; others 404), GET /activities/students?q= (managers or anyone coaching something).
- Activity sessions use the attendance engine (mode/owner_type 'activity', activity_id set, teacher_id
  null; one per activity per day, unique index 0052). prs.generate-sessions plans them per weekday and
  date range, also on a not_school_day (Sabtu ekskul) but never on a holiday. A coach opens one with
  POST /activities/{id}/sessions (today or a past unlocked date) and fills it with POST
  /sessions/{id}/submit (mayFillSession: coachIds). Izin and UKS marks cover them; recomputeDaily and
  the rombel rekap skip them, and an alpa there emits no attendance.absent_marked (changeMarks).
  GET /activities/{id}/recap?from&to counts per member from these sessions only.
- Jurnal 7 KAIH (KEG-02; http/habits.ts, application/habits.ts, table habit_entries, migrations
  0064-0065): behind habits.kaih parent|student (custom kaihOn guard; 'off' is 404). One row per
  (enrollment, date, habit enum habit_code) with value boolean, filled_by, filled_by_role
  orang_tua|siswa, locked_at. PUT /habits/{studentId}/{date} { habits: partial map }: mode parent ->
  only the student's parent (guardians.user_id), mode student -> only the student (students.user_id);
  anyone else who may read gets 409 not_filler. Dates: today and HABIT_EDIT_DAYS (2) back; future 400,
  older or a locked row 409 locked; upsert never touches a locked row. GET /habits/{studentId}?from&to
  (default 7 days, max 31; readers: student, parents, wali kelas, admin/operator/wakasek/kepsek; others
  404). GET /classes/{classId}/habits?weekStart (Monday of that week): daysFilled and ticks per habit
  per active student (wali kelas of the rombel or the leaders). Job keg.lock-habits (00.30 WIB) sets
  locked_at on entries older than 2 days in each school's own date. Every calendar day counts
  (weekends and holidays too).

- Setoran hafalan (KEG-03; http/memorization.ts, application/memorization.ts, table memorization_logs,
  migrations 0067-0068, behind requireCap('religious.memorization')): per student (not enrollment, hafalan
  carries over years): school_date, surah 1-114, juz?, ayat_from..ayat_to (checked against SURAH_AYAT in
  contracts), score 0-100?, note, listener_id = the recorder. Role guru_tahfidz (enum value in 0067).
  POST /memorization-logs (guru_tahfidz, admin; others 403; idempotent, audited memorization.recorded;
  today by default, future 400; 409 not_active without an active enrollment). GET /memorization-logs?studentId
  (student, parents, wali kelas, leaders, writers; others 404; canWrite for writers). GET
  /memorization-logs/students?q= (writers). Listener name from school_member_directory.

## Buku penghubung (ORT-07, modules/portal, packages/db/src/schema/portal.ts)
- communication_threads (one per student, all years), communication_messages (body encrypted,
  sender_role orang_tua|wali_kelas|guru, retracted_at), communication_reads (read cursor per user).
  Migrations 0053-0054, capability portal.liaison (default true).
- Participants are not stored: guardians of the student (orang_tua role), wali kelas of the active
  enrollment's rombel, teachers of its lessons (rombel or learning group). Others 404. The admin
  reads every thread incl. retracted text (audited liaison.thread_viewed) and cannot write.
- Retract only by the sender within LIAISON_RETRACT_MINUTES (15); afterwards permanent (409).
  Each message emits liaison.message_posted.
- GET /liaison/students?q= (2+ letters): students the user teaches this year, to start a thread.
- notify_liaison_message: a parent's message goes to the wali kelas (view homeroom_contacts, phone
  only), a staff message to guardians WITH a portal account (guardians.user_id) and a phone; never
  the text, no action link (params.url to /penghubung or /portal/penghubung). Service hours
  (liaison_settings, default 06.00-18.00, GET|PUT /liaison/settings admin, migrations 0055-0056)
  hold notifications via queueMessages({ window }); releaseTime clamps any window inside the quiet
  hours. Dedup: one per recipient per thread per release hour. Template liaison_message pending.
- Retention (2 tahun ajaran) is not implemented yet.

## Student affairs (KSW, modules/student-affairs, packages/db/src/schema/student-affairs.ts)
- UKS (KSW-08, behind student.uks, role petugas_uks only: even admin does not read the notes):
  uks_visits (enrollment, school_date, visited_at, complaint + action encryptedText, outcome
  kembali_kelas|istirahat|dipulangkan, recorded_by) is insert-only for absah_app. GET /uks/students?q=
  (active, name contains, max 20), POST /uks/visits (idempotent, audited uks.visit_recorded with the
  outcome only, never the notes), GET /uks/visits?date=. Outcome dipulangkan emits uks.sent_home
  { uksVisitId } in the same transaction. Attendance consumer attendance_apply_uks_sent_home
  (application/uks-marks.ts, syncUksMarks) re-reads the visit and writes S with source uks and
  source_ref = the visit in the student's class/group sessions of that date: daily sessions always,
  lessons only while their end time is after the visit on the school clock (visited_at at time zone);
  izin and corrections still outrank it, the teacher cannot overwrite it. generateForSchool also calls
  applyUksToDate, so sessions created later that day get the visits already recorded. Notify consumer
  notify_uks_sent_home (dipulangkan only) queues template student_sent_home (migration 0046, pending
  approval) per guardian with a phone: school, first name, time on the school clock (clockLabel) and the
  action link; dedup key sent_home:<visit>:<guardian>. Never the complaint or any note.
- Point rules (KSW-01, behind student.points; migrations 0077-0078, schema point_rules): one table per school.
  kind violation|achievement, category, name, points (smallint, CHECK: violation -100..-1, achievement 1..100, so the
  sign always agrees with the kind; the contract refines the same rule), active. Switched off, never deleted
  (absah_app has no DELETE): entries (KSW-02) keep a copy of what they cited. Name unique per school ignoring
  case (409). GET /point-rules (admin, kepsek, wakasek, wali kelas, guru; ?all=true adds switched-off rules for
  admin and wakasek only), POST and PUT /point-rules/{id} (admin, wakasek; idempotent; the kind cannot change, new
  points keep its sign). Audit ksw.point_rule_created|updated logs the title as `rule`, not `name`: the audit
  sanitiser redacts every key called name. New role guru_bk (membership_role) and capabilities student.points and
  student.counseling (default true) arrive here; the BK notes themselves come in 5.8e.
- Point entries (KSW-02, behind student.points; migrations 0079-0080, schema point_entries): a pelanggaran or
  prestasi against an enrollment, so totals are per student per academic year. INSERT-ONLY (absah_app has no
  UPDATE, DELETE or TRUNCATE): rule_id plus a copy of kind, category, rule_name and points, so editing or
  switching off a rule never rewrites history. A mistake is undone by a reversing entry (negated points, same kind,
  reverses_entry_id), at most one per entry (unique partial index; CHECK sign applies only to non-reversals).
  Because UPDATE is revoked, SELECT ... FOR UPDATE is impossible too (it needs UPDATE): the unique index
  decides a reversal race (409 already_reversed), do not add a row lock. note is encrypted (point_entries.note);
  audit ksw.point_recorded|reversed keeps ids and points, never the note or reason. Evidence: POST
  /point-entries/evidence presigns a PUT (jpeg/png/webp/pdf, 5 MB) under schools/{id}/ksw/{uuid}; POST
  /point-entries needs the object to exist (400 path evidence). POST /point-entries (admin, wakasek, wali kelas,
  guru; today up to 30 days back; student must be active, rule active else 409 rule_inactive), POST
  /point-entries/{id}/reverse (admin, wakasek; 409 already_reversed|is_reversal), GET /students/{enrollmentId}/points
  and GET /point-entries/{id}/evidence (admin, kepsek, wakasek, the class's wali kelas; other wali kelas get 404,
  guru and others 403). Net totals come from plain sums because a reversal carries the kind it cancels. In a
  single-table drizzle select, ${table.col} inside a correlated subquery renders as a bare column and binds to the
  inner table: qualify it by hand (see isReversed in point-entry-repo.ts).
- Point thresholds and follow-up tasks (KSW-03, behind student.points; migrations 0081-0083, schema point_thresholds
  and followup_tasks): a tier is minPoints (1..1000) on the NET pelanggaran points of the student's year (positive
  number), label, action, notifyParents, active; unique per school on minPoints, switched off never deleted.
  recordPointEntry, for a pelanggaran only, takes pg_advisory_xact_lock per enrollment, reads the total, inserts, then
  raiseThresholdTasks: pure domain/thresholds.ts crossedThresholds(before, after, tiers) (before < min <= after,
  lowest first, nothing when the total falls) and one followup_tasks row per tier per enrollment (unique index +
  ON CONFLICT DO NOTHING, so falling back and climbing again makes no second task); each new task emits
  ksw.threshold_reached. The lock is what lets two simultaneous entries notice a tier they cross together. Tiers made
  later are NOT applied backwards. The task copies label/action/minPoints (editing a tier changes nothing already
  made). Consumer notify_ksw_threshold_reached (only when the tier has notifyParents) uses template
  student_discipline_threshold (0083, approval pending): school and first name only, never points or rule. Dedup key
  threshold:<task>:<guardian>. Endpoints: GET|POST /point-thresholds, PUT /point-thresholds/{id} (read: admin,
  kepsek, wakasek, wali kelas, guru BK; write: admin, wakasek), GET /followup-tasks[?status] (admin, kepsek, wakasek,
  guru BK see all; a wali kelas only their class; guru 403), POST /followup-tasks/{id}/complete (admin, wakasek, guru
  BK, the class's wali kelas; kepsek reads only; open to done once, 409 already_done; the note is encrypted and not
  audited). Staff push for new tasks is not wired yet (early warnings in 5.8d will push).
- TPPK (KSW-06/07, behind student.tppk; schema/tppk.ts, migrations 0047-0048): own Postgres schema
  "tppk" with explicit GRANTs. tppk.members is the source of truth for access (not the membership role
  'tppk'); reports, cases and case_events have RLS "school AND app.user_id in tppk.members", so admin,
  kepsek, jobs (user null) and support read 0 rows. Reports: INSERT allowed to any context, WITHOUT
  RETURNING (the reporter cannot read it back; non-member UPDATE touches 0 rows). case_events are
  insert-only; nothing is deletable by absah_app. tppk.report_status(code_hash) is SECURITY DEFINER and
  returns only the status for the tracking page. GET /tppk/members (any staff), PUT /tppk/members (admin,
  replaces the team, members must be active staff, belowMinimum under TPPK_MIN_MEMBERS = 3, audited,
  emits tppk.members_changed {added, removed} so the team sees every change).
  Pitfall: in sql`(select ... from school_member_directory d where d.user_id = ${col})` a column
  named user_id renders bare and binds to the view's own column; qualify it by hand.
- TPPK public flow (no login; application/tppk-reports.ts): GET /tppk/channel/{schoolId} (school name,
  same 404 for unknown or student.tppk off), POST /tppk/reports (201 {trackingCode, status}), GET
  /tppk/reports/track/{code} (status only, via withAnonymous + tppk.report_status). Tracking code: 10
  Crockford base32 chars (normalizeTrackingCode: upper case, no dashes, O->0, I/L->1), stored as
  hashValue('tppk-tracking:' + code), shown once. Malformed and unknown codes do the same lookup and
  get the same 404. Anonymous: the session is not even read, audit tppk.report_filed has no actor and
  omitIp. No Idempotency-Key on the public POST (the stored answer would hold the code); a lost answer
  means the reporter may file twice. Emits tppk.report_received {reportId} (consumer in 5.2d).
- shared/rate-limit.ts memoryRateLimit: per process, key = hashValue(name + clientIp), never stored or
  logged (report 5/h, track 30/10 min, channel 60/h). Cloudflare rules on /api/v1/tppk/* stay the first
  line. maskPath (shared/logger.ts) replaces the code in logged request paths; test/tppk-report.test.ts
  captures the log and checks no IP, chronology or code (buildTestApp({ logger })).
- TPPK cases (application/tppk-cases.ts, members only via asMember: isMember check -> 403, RLS
  underneath): GET /tppk/reports[?status], GET /tppk/reports/{id} (chronology; reporter null when
  anonymous), GET|POST /tppk/cases, GET /tppk/cases/{id} (report + events), POST .../events (catatan |
  langkah, open cases only), POST .../close and .../reopen (each an event too). Report status follows:
  case opened -> ditangani, closed -> selesai, reopened -> ditangani. One case per report (409).
  Every read and write audits tppk.<verb> with ids, counts and statuses only.
- TPPK notifications (migration 0049): view tppk.member_contacts (security_barrier, owned by the
  migration role because absah_app cannot read "user") gives user_id, name, phone of the current
  school's TPPK members only. Notify consumers notify_tppk_report_received (template
  tppk_report_received: school + link to /tppk, nothing about the report) and notify_tppk_team_changed
  (tppk_team_changed: added/removed names to the CURRENT team). Both templates pending approval.
  Members without a phone get nothing until staff push (NTF-06); TppkMember.canBeNotified shows it.

## Report (RKP, modules/report)
- Rekap reads daily_attendance only (one status per enrollment per school date): GET /reports/semesters,
  /reports/attendance/classes?from&to (per rombel), /reports/attendance/classes/{id}?from&to (per
  enrollment; a student who changed rombel shows in each with the days there). One day = rekap harian,
  semester dates = rekap semester. Managers (admin, operator, kepsek, wakasek) see every rombel, a wali
  kelas (classes.homeroom_teacher_id) their own; presentRate = (H + T) / days.
- Jurusan (AKD-11): ClassRecapList items carry stream; GET /reports/attendance/classes?stream=ipa|ips|bahasa|
  keagamaan keeps one jurusan (a wali kelas is still refused without a rombel, then filtered). POST /exports
  takes stream (whole-year exports only; with classId 400), stored in export_jobs.stream (0066); the file
  has only that jurusan's rombel and is named ...-jurusan-IPA.xlsx.
- GET /reports/session-compliance (RKP-04, wakasek/kepsek/admin): class and daily sessions per teacher
  and day: filled (submitted/locked), filledLate (submitted after reminded_at), missed, open.
- Exports (export_jobs): POST /exports { format xlsx|pdf, semesterId, classId? } (idempotent, 202,
  audited, emits export.requested; whole school = managers only; target from report.target, no exporter
  = 409 target_unavailable; rdm without its release flag = 409 release_flag_off) -> consumer report_build_export builds the file in a savepoint, writes it to
  schools/{id}/exports/{job id}, status done (or failed on the last of 3 tries) -> GET /exports/{id}
  /download (presigned attachment, requester only). Job report.export_retention (02:50) removes files
  after 7 days (status expired).
- Exporters implement ReportExporter (domain/semester-recap.ts) in infrastructure/exporters/<target>;
  exporterFor(target). The semester file counts a student's whole semester under the rombel of their
  latest enrollment; students who left (moved/left) are omitted. xlsx = import sheet (one per rombel),
  pdf = archive with H/T/S/I/A and signature blocks (kepala sekolah from the directory, wali kelas).
- e-Rapor columns (exporters/erapor/columns.ts) are NOT confirmed: TODO(pilot), see
  packages/db/fixtures/erapor/README.md. Do not drop the TODO before a real import succeeded.
- RDM (RKP-07, report.target rdm): exporters/rdm (RDM_COLUMNS TODO(pilot), PDF signed "Kepala Madrasah");
  both targets build with exporters/common (recapWorkbook(recap, columns), recapPdf(recap, labels)).
  Release flag rdm-export-beta must be on for the school (platform_flags, owner role; readReleaseFlags in
  shared/capability.ts), else POST /exports answers 409 release_flag_off. See packages/db/fixtures/rdm/README.md.
- Release flags (packages/capabilities release.ts RELEASE_FLAGS): built-but-unvalidated features, off by
  default, set by the Absah team in platform_flags (value true; school row beats global). Not capabilities:
  killSwitches skips them. Remove a flag once the feature is released.
  Ops CLI: `pnpm --filter @absah/server release:flag --flag <name> (--school <id> | --all) [--off]`
  (platform setReleaseFlag, withPlatform upsert on (key, school_id)); e2e uses it too.

## MBG (RKP-08, modules/report, behind requireCap('mbg.enabled'))
- mbg_settings (one row per school: cutoff_time default 08.30, pic_name, pic_phone encryptedText; the PIC
  is not an account). GET /mbg/settings (masked number; admin, operator, kepsek, wakasek), PUT (admin,
  idempotent, audited without the number; picPhone left out keeps the stored number, null removes it).
- mbg_daily_counts: per rombel per school date enrolled, present_at_cutoff (H + T; S/I/A not counted),
  unrecorded (no attendance yet), forecast_h3 (RKP-09, later), sent_at. Insert-only (no UPDATE/DELETE
  for absah_app): a correction is a new row with supersedes_id = the row it replaces; the current number
  is the row nobody supersedes. One cutoff row (supersedes_id null) per rombel and day.
- GET /mbg/daily?date=: pending = live from daily_attendance, counted = stored rows, not_school_day.
- Job rkp.mbg-cutoff (every 5 min, UTC cron, each school on its own clock like the PRS jobs): with
  mbg.enabled, once the school clock passes cutoff_time and today's sessions were generated
  (attendance_days.generated_at; holidays never count), stores one row per rombel under lockMbgDay,
  once per date, and emits mbg.count_ready { schoolDate, correction } when a PIC number is set.
- POST /mbg/daily/recount (admin, today only, 409 not_counted before the cutoff): rombel whose numbers
  changed get a superseding row, audited mbg.recounted, event with correction true; unchanged = no-op.
- notify_mbg_count sends template mbg_count / mbg_count_corrected to the PIC (no guardian, no action
  link; queueMessages recipients without guardianId get none): total present + "1A 28, 1B 25 (3 belum
  diisi)" on one line (template params cannot hold line breaks). Templates added in migration 0039.
- Prakiraan H-3 (RKP-09): job rkp.mbg-forecast (every 5 min, each school from 13.00 local) stores
  mbg_forecasts for today + 3 calendar days when that is a school day (attendance schoolDayOf), once
  per date: per rombel enrolled - approved izin - members of an active luar_sekolah activity meeting
  that day (izin wins when both). Insert-only (0057-0058; forecast_h3 dropped from
  mbg_daily_counts). Emits mbg.forecast_ready; notify_mbg_forecast sends template mbg_forecast
  (pending) to the PIC. GET /mbg/forecast?date= (default today + 3): computed | pending.
- An activity without weekdays but with both dates (kemah) meets every day of its range: sessions
  (planActivitySessions) and the forecast use the same rule.

## Pilot data (prompt 4.4, packages/db/seed)
- pilotPlan() (seed/pilot-plan.ts) is pure and deterministic (seed 20270111): "SMA Absah Uji 1" (NPSN
  99999911, Asia/Jakarta), year 2026/2027 with semester 2 from 2027-01-11, jam 1-9 Mon-Thu and 1-6 Fri,
  36 rombel X-1..XII-12 (XI/XII 1-6 ipa, 7-12 ips) x 25 synthetic students (NISN 99<grade><n>), one
  guardian each (+628119<n>, synthetic), 82 teachers placed greedily (one subject, <= 24 lessons, never
  twice at a time; each rombel's wali kelas teaches it; guru001-002 also piket), and mapel pilihan for
  XI/XII: two blocks of 4 lessons where every student is in one of 8 groups. Tests check all of it.
- writePilot (seed/pilot.ts) inserts it in one tenant transaction; `PILOT_PASSWORD=... pnpm --filter
  @absah/server pilot:seed` creates the staff accounts (<key>@pilot.absah.test: admin, kepsek, wakasek,
  operator, guru001...) and runs it once (a second run prints the existing school). It refuses unless
  WHATSAPP_PROVIDER=fake: the guardian numbers are invented and must never receive messages.
- Parallel run of X-1 (11-22 Jan 2027) on staging: `attendance:generate --school <id> --date 2027-01-11 --force`.

## ETL from the old project-attendance app (packages/db/etl)
- `pnpm --filter @absah/db etl:project-attendance --dump <file.sql> --school <id> --out <dir> [--apply]`.
  Reads a local mysqldump (readDump: CREATE TABLE column order + INSERT rows, no MySQL server), maps
  it (mapProjectAttendance, pure) and writes gagal.csv, undang-ulang.csv, siswa.csv. Dry-run unless --apply.
- Mapping: rombel = type_class.category (grade, roman or digits) + class_room.name; stream from the name;
  students not graduated with NISN padded back to 10 digits (bigint in the old schema), enrollment from
  the open student_class_histories row (never before the year start); teachers -> re-invite list with
  NIP, WhatsApp number and wali kelas of (old passwords are never read). Attendance history, payments
  and schedules stay in the old system. Failures: tingkat_tidak_dikenal, rombel_ganda, nisn_tidak_valid,
  nisn_ganda, rombel_tidak_ditemukan, nama_kosong.
- applyEtl: one tenant transaction under the student import lock, into the active academic year (none ->
  stop), rombel matched by name, students whose NISN already exists skipped, so reruns add nothing.
- Fixture: fixtures/project-attendance/dump.sql (synthetic). The output CSVs hold personal data: write
  them outside the repo and delete them after go-live.

## Workspace billing (BIL, modules/subscription, packages/db/src/schema/subscription.ts)
- Pure rules in domain/invoice.ts computeInvoice(enrollments, exemptDays, month): Rp10.000 per active
  student per month, pro rata per calendar day (active days / days in month), a student counts once per
  day across enrollments, billing_exempt days are not billed, rounded once on the total (never per
  student). Table tests in invoice.test.ts; change the rules only together with them.
- invoices (one per school and month, whole rupiah, status issued|paid|void), invoice_lines (days +
  exact share numeric(14,4)), payments (VA/QRIS attempt; unique (provider, provider_txn_id) so a
  webhook delivered twice records one payment). The app role cannot delete invoices or lines, nor
  update lines.
- calendar_days.billing_exempt: only the Absah team (owner role) sets, clears or deletes exempt days;
  trigger calendar_days_guard_billing_exempt raises for absah_app. Ordinary holidays stay the school's.
- Job bil.issue-invoices (07.00 WIB on days 1-7, tz Asia/Jakarta for every school): previous month,
  issueInvoiceForSchool per school in withTenant (withPlatform only to list schools); unique (school,
  month) + onConflictDoNothing make reruns no-ops; a month without billed student-days issues nothing.
  Enrollments of any year overlapping the month count; due 14 days after issue.
- GET /billing/invoices, GET /billing/invoices/{id} (lines with student name/NISN): admin and kepsek.
- Ops: `pnpm --filter @absah/server billing:exempt --school <id> --from --to [--name] [--remove]`
  (owner role) marks a long year-end break as exempt holidays; short breaks stay billed.
  `billing:issue --school <id> --month YYYY-MM` issues one month now (idempotent; ops, e2e).
- Payments (shared/payments PaymentProvider; PAYMENT_PROVIDER none|fake, fake refused in production,
  PAYMENT_WEBHOOK_SECRET required with a gateway; a real gateway adapter comes with its sandbox account):
  POST /billing/invoices/{id}/payments { method va|qris } (admin, idempotent, 202, audited; reuses an
  open attempt of the same method; 409 already_paid | invoice_void | payments_unavailable) stores a
  requested payment + payment.requested -> consumer subscription_open_payment calls createCharge with
  our payment id as external id (retryable errors retry, last attempt -> failed) -> pending with VA
  number / QR string (24 h). Webhook POST /api/v1/webhooks/payments (raw body, signature; FakePaymentProvider:
  x-absah-signature sha256 HMAC) -> inbox 'payment:<provider>' -> job bil.apply-payments (every
  minute) marks the payment paid once (state + unique provider_txn_id) and the invoice paid; less money
  than due keeps it open (last_error underpaid:<amount>). A pending charge past expires_at reads expired.

## PKL (SMK, modules/pkl, packages/db/src/schema/pkl.ts, behind requireCap('pkl.enabled'))
- dudi_partners (name unique per school, address, precise latitude/longitude, radius_m default 150,
  25-2000), dudi_work_hours (one row per ISO weekday; no row = closed, no session), pkl_placements
  (enrollment x DUDI x starts_on..ends_on, school_mentor_id = guru pembimbing, industry_mentor_id =
  pembimbing industri or null, status active|cancelled), pkl_checkins (one in + one out per placement
  per school date; point rounded to 4 decimals, distance_m, review_reasons, late, confirm_status on
  check-ins only; no DELETE for absah_app), pkl_journals (one per placement per date, attachment in R2).
  Migrations 0069-0070. attendance_sessions.pkl_placement_id has an FK (restrict) and one pkl session
  per placement per date (attendance_sessions_pkl_date_key).
- Pure rules in domain/checkin-rules.ts: classifyCheckin (haversine distance from the reported point,
  radius edge inside; check-in window from 60 min before opening to closing, check-out from opening to
  3 h after closing; device clock > 10 min off; no industry supervisor) -> pending (industry supervisor
  confirms) or needs_review (guru pembimbing decides). A check-in after opening time is late: confirmed
  as T. GPS accuracy is stored, never widens the radius. The industry supervisor never sees coordinates.
- Partners (http/partners.ts, application/partners.ts): managers canManagePkl = admin, wakasek, humas_pkl;
  readers canSeeAllPkl add kepsek. GET|POST /pkl/partners, PATCH /pkl/partners/{id} (idempotent, audited
  pkl.partner_created|updated; workHours replaced as a whole; name taken 409). Pickers for placements:
  GET /pkl/students?q= (name or NISN, active this year), GET /pkl/school-mentors (active school staff:
  STAFF_ROLES minus pembimbing_industri, who is not school staff). OpenAPI paths in contracts pkl/paths.ts.
- Placements (http/placements.ts, application/placements.ts): GET /pkl/placements?partnerId&scope=current|all
  (managers + kepsek all, anyone else where they are guru pembimbing), POST /pkl/placements (batch: up to 40
  enrollments, one DUDI, one period <= 1 year ending today or later, schoolMentorId = active school staff,
  industryMentor {name, phoneNumber} optional), PATCH /pkl/placements/{id} (endsOn, schoolMentorId,
  industryMentor; null removes), POST .../cancel (again = no-op). Writes run under lockPlacements (advisory
  lock per school); overlapping active placements of an enrollment -> 409 overlap + details.enrollmentIds.
  Audited pkl.placement_created|updated|cancelled with ids only (never the phone number).
- Industry supervisor (pembimbing_industri): no invitation. platform sharedPhoneLogin (owner of the number
  or a new phone account; a student's own login -> 409 phone_student), then setPortalMembership(role
  pembimbing_industri) active while they have a placement not cancelled and not ended (syncMentorAccess on
  every write; job pkl.expire-mentors 00.05 WIB suspends the rest on each school's own date). A new
  supervisor emits pkl.mentor_assigned {userId} -> notify_pkl_mentor_assigned sends template
  pkl_mentor_assigned (school, count, url /dudi; pending approval; one per supervisor per day) to the
  number from view pkl_mentor_contacts (migration 0071, like homeroom_contacts). Responses mask the number.
- PKL sessions (attendance module, PKL-02): prs.generate-sessions plans one session per running placement
  (pklPlacementsOn: not cancelled, active enrollment, date in period) on the DUDI's work days (planPklSessions:
  mode pkl, owner placement, pkl_placement_id, no teacher), also on a not_school_day (Saturday), never on a
  holiday. roster/rosterSize/ownerName (DUDI name) know owner placement; izin and UKS coverage include pkl
  sessions; recomputeDaily counts pkl sessions (a PKL day is the student's school day) and changeMarks emits
  attendance.absent_marked for a PKL alpa. Nobody fills a pkl session through /sessions/{id}/submit
  (mayFillSession false) and Hari ini leaves them out (withoutPkl). The pkl module uses attendance's
  openPklSession (creates the session when missing; locked when the day is already locked) and setPklStatus
  (changeMarks with source pkl_confirm, sourceRef = check-in or null).
- Check-in (http/checkins.ts, application/checkins.ts; canCheckIn = siswa): POST /pkl/checkins
  (PklCheckinBody {kind in|out, latitude, longitude, accuracyM?, deviceTime}; Idempotency-Key required, 201)
  finds the student's running placement through students.user_id (none -> 409 no_placement), classifies
  it, stores the rounded point, one per kind per day (409 already_recorded), opens today's pkl session on a
  check-in, emits pkl.checkin_recorded {checkinId} (no consumer yet) and audits without coordinates.
  GET /pkl/me: placement (DUDI name/address/radius, supervisors' names, today's hours) + today's check-in/out,
  never coordinates. A check-in's status: confirmed -> H/T (late), decided -> decided_status.
- Industry supervisor (http/supervision.ts, application/supervision.ts; canSuperviseAtDudi = pembimbing_industri,
  rows filtered by industry_mentor_id): GET /pkl/supervision?date (default today, future 400) lists their
  running placements with check-in status, never coordinates or distance. POST /pkl/checkins/confirm {date?,
  checkinIds?} confirms every pending check-in of that day (one click) or the listed ones; an id of another
  supervisor's student -> 404 and nothing written. POST /pkl/checkins/{id}/dispute {reason} (pending only, else
  409 not_pending) -> disputed (guru pembimbing decides). Confirmation = openPklSession + setPklStatus H/T
  (late) with sourceRef = check-in. Job pkl.auto-confirm (hourly, :07 UTC) confirms check-ins pending > 24 h
  (confirmed_by null); withPlatform only lists schools with such rows.
- Guru pembimbing review (http/reviews.ts, application/reviews.ts): GET /pkl/reviews = open queue (the
  placement's school_mentor_id; canManagePkl sees all; others get an empty list): check-ins needs_review or
  disputed, and pkl sessions before today with no check-in and no record. POST /pkl/days/{sessionId}/decide
  {status H|T|S|I|A}: the placement's guru pembimbing or a manager (else 404); a future day 400; a check-in
  pending (409 pending_industry) or confirmed (409 confirmed) belongs to the industry supervisor; otherwise
  the check-in (if any) becomes decided and setPklStatus writes the status (deciding again replaces it).
  Audited pkl.day_decided.
- Job pkl.missing-checkin (every 5 min UTC, each school's clock): from 10.00, or an hour after a later
  opening (missingCheckinDue), today's pkl sessions without check-in or record emit pkl.checkin_missing
  {sessionId} once (attendance markSessionsReminded sets reminded_at; pkl sessions have no teacher, so the
  PRS reminder never touches them). notify_pkl_checkin_missing sends template pkl_checkin_missing (pending)
  to the student's login number from view student_login_contacts (migration 0072); url /portal/pkl.
- Jurnal PKL (PKL-03; http/journals.ts, application/journals.ts): POST /pkl/journals/attachments (siswa,
  presigned PUT schools/{id}/pkl/{uuid}, 201) then POST /pkl/journals {date?, activity, competency?,
  attachment?} (siswa; today or up to 7 days back inside the running placement via studentPlacementOn, else
  409 no_placement; the file must exist, else 400 attachment). One journal per placement per date: a rewrite
  goes back to submitted (attachment undefined keeps, null removes; the old file is removed after commit);
  approved -> 409 approved. GET /pkl/journals?placementId&status&from&to (default last 31 days): siswa own,
  canSeeAllPkl all, others the placements they supervise (school or industry). POST /pkl/journals/{id}/review
  {decision approved|revision, note (required for revision)}: the placement's guru pembimbing, its industry
  supervisor or canManagePkl (else 404); submitted only (409 not_submitted). GET .../attachment: 5-minute link
  for anyone who sees the journal. Audited pkl.journal_written|updated|reviewed (no text).
