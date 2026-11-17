-- tppk schema (KSW-06/07). Default privileges of migration 0001 cover only "public", so every grant
-- here is explicit. Reports, cases and case events are readable only by the school's TPPK members:
-- not the admin, not the kepsek, not Absah support. Anyone in the school's context may file a report
-- (INSERT without RETURNING: the reporter cannot read the row back).
GRANT USAGE ON SCHEMA "tppk" TO absah_app;--> statement-breakpoint
GRANT SELECT, INSERT, DELETE ON "tppk"."members" TO absah_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tppk"."reports" TO absah_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON "tppk"."cases" TO absah_app;--> statement-breakpoint
GRANT SELECT, INSERT ON "tppk"."case_events" TO absah_app;--> statement-breakpoint

-- members: who is on the team is not secret (the team is announced to the school).
ALTER TABLE "tppk"."members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tppk"."members"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "tppk"."reports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tppk_report_insert ON "tppk"."reports" FOR INSERT
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY tppk_members_read ON "tppk"."reports" FOR SELECT
  USING (
    school_id = nullif(current_setting('app.school_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM "tppk"."members" m
                 WHERE m.school_id = reports.school_id
                   AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  );--> statement-breakpoint
CREATE POLICY tppk_members_update ON "tppk"."reports" FOR UPDATE
  USING (
    school_id = nullif(current_setting('app.school_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM "tppk"."members" m
                 WHERE m.school_id = reports.school_id
                   AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  )
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint

ALTER TABLE "tppk"."cases" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tppk_members_only ON "tppk"."cases"
  USING (
    school_id = nullif(current_setting('app.school_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM "tppk"."members" m
                 WHERE m.school_id = cases.school_id
                   AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  )
  WITH CHECK (
    school_id = nullif(current_setting('app.school_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM "tppk"."members" m
                 WHERE m.school_id = cases.school_id
                   AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  );--> statement-breakpoint

ALTER TABLE "tppk"."case_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tppk_members_only ON "tppk"."case_events"
  USING (
    school_id = nullif(current_setting('app.school_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM "tppk"."members" m
                 WHERE m.school_id = case_events.school_id
                   AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  )
  WITH CHECK (
    school_id = nullif(current_setting('app.school_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM "tppk"."members" m
                 WHERE m.school_id = case_events.school_id
                   AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  );--> statement-breakpoint

-- Tracking (GET /tppk/reports/track/{code}): the only way past the policies above, and it returns
-- the status alone. The caller passes the HMAC of the code, never the code. Owned by the migration
-- role (which owns the tables), so it reads without the member check.
CREATE FUNCTION "tppk"."report_status"(p_code_hash text) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog
  AS $$ SELECT r.status::text FROM "tppk"."reports" r WHERE r.tracking_code_hash = p_code_hash $$;--> statement-breakpoint
REVOKE ALL ON FUNCTION "tppk"."report_status"(text) FROM PUBLIC;--> statement-breakpoint
GRANT EXECUTE ON FUNCTION "tppk"."report_status"(text) TO absah_app;
