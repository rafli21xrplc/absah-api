-- habit_entries: tenant table, RLS like every other. No TRUNCATE.
ALTER TABLE "habit_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "habit_entries" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "habit_entries"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
