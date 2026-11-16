ALTER TABLE "attendance_marks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "attendance_marks" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "attendance_marks"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
-- Existing records become their source's mark.
INSERT INTO "attendance_marks" (school_id, session_id, enrollment_id, source, status, source_ref, recorded_by, recorded_at)
  SELECT school_id, session_id, enrollment_id, source, status, source_ref, recorded_by, recorded_at FROM "attendance_records"
  ON CONFLICT DO NOTHING;
