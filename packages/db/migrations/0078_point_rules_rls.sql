-- point_rules: tenant table, RLS like every other. Rules are switched off, never deleted, because
-- point entries (KSW-02) cite them.
ALTER TABLE "point_rules" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "point_rules" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "point_rules"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
