-- early_warnings and early_warning_runs: tenant tables, RLS like every other. Both are insert-only for
-- absah_app: a warning records what the job saw that evening, a run row records that the day was handled.
ALTER TABLE "early_warnings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "early_warning_runs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "early_warnings" FROM absah_app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "early_warning_runs" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "early_warnings"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY tenant_isolation ON "early_warning_runs"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
