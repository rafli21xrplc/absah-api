-- visitors: tenant table, RLS like every other. No TRUNCATE.
ALTER TABLE "visitors" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "visitors" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "visitors"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
