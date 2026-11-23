-- mbg_settings, mbg_daily_counts: tenant tables, RLS like every other. No TRUNCATE.
ALTER TABLE "mbg_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "mbg_settings" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "mbg_settings"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "mbg_daily_counts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
-- Counts sent to the PIC never change: a correction is a new row (supersedes_id).
REVOKE UPDATE, DELETE, TRUNCATE ON "mbg_daily_counts" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "mbg_daily_counts"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
