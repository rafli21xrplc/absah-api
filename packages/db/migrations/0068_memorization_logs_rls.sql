-- memorization_logs: tenant table, RLS like every other. No TRUNCATE.
ALTER TABLE "memorization_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "memorization_logs" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "memorization_logs"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
