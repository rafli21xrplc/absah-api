-- webhook_endpoints: tenant table, RLS like every other. The secret and the owner never change (a new secret is a new
-- endpoint); the app role updates only what the admin may edit. Deleting an endpoint is allowed (a mistake, a retired system).
ALTER TABLE "webhook_endpoints" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE UPDATE, TRUNCATE ON "webhook_endpoints" FROM absah_app;--> statement-breakpoint
GRANT UPDATE ("url", "events", "active", "updated_at") ON "webhook_endpoints" TO absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "webhook_endpoints"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
