-- workspace_exports: tenant table, RLS like every other. The worker updates status/file fields; rows are never truncated.
ALTER TABLE "workspace_exports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "workspace_exports" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "workspace_exports"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
