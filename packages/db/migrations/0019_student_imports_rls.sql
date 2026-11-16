ALTER TABLE "student_imports" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "student_imports" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "student_imports"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
