-- Tracer links: tenant table, RLS like every other. Only the HMAC of the secret is stored; links are never deleted by the app.
ALTER TABLE "tracer_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE, DELETE ON "tracer_links" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tracer_links"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
