-- exam_attendance: tenant table with RLS, append-only (the app role can neither update nor delete a check-in).
ALTER TABLE "exam_attendance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "exam_attendance" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "exam_attendance"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
