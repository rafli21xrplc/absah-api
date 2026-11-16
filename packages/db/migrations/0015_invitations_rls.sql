-- Invitations are tenant rows. Acceptance runs in withTenant(schoolId from the token, no user).
ALTER TABLE "invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "invitations" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "invitations"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
