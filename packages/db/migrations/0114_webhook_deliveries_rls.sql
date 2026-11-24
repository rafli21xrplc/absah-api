-- webhook_deliveries: tenant table, RLS like every other. The app role may only record the outcome of a call; rows go away with
-- their endpoint (foreign key cascade), never by hand.
ALTER TABLE "webhook_deliveries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "webhook_deliveries" FROM absah_app;--> statement-breakpoint
GRANT UPDATE ("status", "attempts", "last_status", "last_error", "finished_at") ON "webhook_deliveries" TO absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "webhook_deliveries"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
