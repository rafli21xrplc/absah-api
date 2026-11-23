-- export_jobs: tenant table, RLS like every other. No TRUNCATE.
ALTER TABLE "export_jobs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "export_jobs" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "export_jobs"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
