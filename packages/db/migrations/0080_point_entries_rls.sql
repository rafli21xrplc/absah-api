-- point_entries: tenant table, RLS like every other. Insert-only: an entry may already have told the
-- parents or crossed a threshold, so there is no UPDATE, DELETE or TRUNCATE for absah_app. A mistake
-- is undone by a reversing entry.
ALTER TABLE "point_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "point_entries" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "point_entries"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
