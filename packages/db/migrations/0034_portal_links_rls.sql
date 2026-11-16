-- action_links: tenant table, RLS like every other. No TRUNCATE.
ALTER TABLE "action_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "action_links" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "action_links"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
