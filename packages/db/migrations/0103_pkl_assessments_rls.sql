-- PKL assessment tables: tenant tables, RLS like every other. Aspects are retired, never deleted.
ALTER TABLE "pkl_assessment_aspects" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE, DELETE ON "pkl_assessment_aspects" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "pkl_assessment_aspects"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "pkl_assessments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "pkl_assessments" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "pkl_assessments"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "pkl_assessment_scores" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "pkl_assessment_scores" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "pkl_assessment_scores"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
