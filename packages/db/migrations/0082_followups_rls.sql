-- point_thresholds and followup_tasks: tenant tables, RLS like every other. Tiers are switched off and
-- tasks are closed, never deleted: tasks cite their tier, and a closed task is the record of what was done.
ALTER TABLE "point_thresholds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "followup_tasks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "point_thresholds" FROM absah_app;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "followup_tasks" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "point_thresholds"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY tenant_isolation ON "followup_tasks"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
