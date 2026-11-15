-- audit_logs is append-only for the app role: anyone acting in a school may INSERT its rows,
-- only an active admin of that school may SELECT, nobody may UPDATE or DELETE.
-- Retention (2 years) is enforced by a job using the owner role, not by absah_app.
REVOKE UPDATE, DELETE, TRUNCATE ON "audit_logs" FROM absah_app;--> statement-breakpoint
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_insert ON "audit_logs" FOR INSERT
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY admin_read ON "audit_logs" FOR SELECT
  USING (
    school_id = nullif(current_setting('app.school_id', true), '')::uuid
    AND EXISTS (
      SELECT 1 FROM "memberships" m
       WHERE m.school_id = "audit_logs".school_id
         AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
         AND m.role = 'admin'
         AND m.status = 'active'));
