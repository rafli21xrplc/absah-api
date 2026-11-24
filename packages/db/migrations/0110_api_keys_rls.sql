-- api_keys: tenant table, RLS like every other. The key is revoked, never deleted; the app role updates only last_used_at and
-- the revocation columns.
ALTER TABLE "api_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "api_keys" FROM absah_app;--> statement-breakpoint
GRANT UPDATE ("last_used_at", "revoked_at", "revoked_by") ON "api_keys" TO absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "api_keys"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
