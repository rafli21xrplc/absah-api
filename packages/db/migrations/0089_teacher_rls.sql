-- teacher_attendance, teacher_leaves, session_substitutions: tenant tables, RLS like every other.
--   teacher_attendance: a row is the first check-in; only checked_out_at may change afterwards (column grant).
--   teacher_leaves: the decision and the cancellation change a row, nothing else; never deleted.
--   session_substitutions: insert-only, it is the history of who took a session over.
ALTER TABLE "teacher_attendance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "teacher_leaves" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "session_substitutions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "teacher_attendance" FROM absah_app;--> statement-breakpoint
GRANT UPDATE ("checked_out_at") ON "teacher_attendance" TO absah_app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "teacher_leaves" FROM absah_app;--> statement-breakpoint
GRANT UPDATE ("status", "decided_by", "decided_at", "decision_note", "cancelled_at") ON "teacher_leaves" TO absah_app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "session_substitutions" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "teacher_attendance"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY tenant_isolation ON "teacher_leaves"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY tenant_isolation ON "session_substitutions"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
