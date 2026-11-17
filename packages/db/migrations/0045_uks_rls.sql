-- uks_visits: tenant table, RLS like every other. Insert-only: a visit already marked attendance
-- and told the parents, so there is no UPDATE, DELETE or TRUNCATE for absah_app.
ALTER TABLE "uks_visits" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "uks_visits" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "uks_visits"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
