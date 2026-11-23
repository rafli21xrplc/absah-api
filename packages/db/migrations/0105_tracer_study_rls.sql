-- Tracer study tables: tenant tables, RLS like every other. Alumni and answers are personal data: the app never deletes them in bulk.
ALTER TABLE "tracer_alumni" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "tracer_alumni" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tracer_alumni"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "tracer_responses" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "tracer_responses" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "tracer_responses"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
