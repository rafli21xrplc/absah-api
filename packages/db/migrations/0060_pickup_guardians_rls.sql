-- pickup_guardians: tenant table, RLS like every other. No TRUNCATE.
ALTER TABLE "pickup_guardians" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "pickup_guardians" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "pickup_guardians"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
