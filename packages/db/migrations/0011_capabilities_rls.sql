-- school_capabilities: tenant table, read and written by the school's admin use cases.
ALTER TABLE "school_capabilities" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "school_capabilities"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint

-- platform_flags: kill switches managed by the Absah team with the owner role. The app role may
-- only read the global rows and its own school's rows.
ALTER TABLE "platform_flags" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "platform_flags" FROM absah_app;--> statement-breakpoint
CREATE POLICY read_global_and_own ON "platform_flags" FOR SELECT
  USING (school_id IS NULL OR school_id = nullif(current_setting('app.school_id', true), '')::uuid);
