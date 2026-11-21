-- Notification preferences (ORT-06): tenant table, RLS like every other. No TRUNCATE.
ALTER TABLE "notification_preferences" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "notification_preferences" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "notification_preferences"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
