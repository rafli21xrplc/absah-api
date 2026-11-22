-- exam_periods: tenant table with RLS. Never deleted by the app role (a period closes with closed_at); only the columns the
-- school edits can change, the academic year and who created it cannot.
ALTER TABLE "exam_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "exam_periods" FROM absah_app;--> statement-breakpoint
GRANT UPDATE ("name", "starts_on", "ends_on", "min_attendance", "attendance_from", "excused_counts", "require_paid", "fee_type_ids", "closed_at") ON "exam_periods" TO absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "exam_periods"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
