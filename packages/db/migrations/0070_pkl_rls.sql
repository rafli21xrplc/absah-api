-- PKL tables: tenant tables, RLS like every other. No TRUNCATE.
ALTER TABLE "dudi_partners" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "dudi_partners" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "dudi_partners"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "dudi_work_hours" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "dudi_work_hours" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "dudi_work_hours"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "pkl_placements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "pkl_placements" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "pkl_placements"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
-- Check-ins are never deleted by the app (location evidence until the PKL grade is final + 1 year).
ALTER TABLE "pkl_checkins" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE, DELETE ON "pkl_checkins" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "pkl_checkins"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "pkl_journals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "pkl_journals" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "pkl_journals"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
