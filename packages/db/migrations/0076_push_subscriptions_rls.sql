-- Push subscriptions (NTF-06): tenant table. Stricter than the usual policy because the endpoint
-- plus keys let anyone push to that browser: inside a request (app.user_id set) a member only
-- sees their own rows; jobs and consumers (no user) read per school to send.
ALTER TABLE "push_subscriptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "push_subscriptions" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "push_subscriptions"
  USING (
    school_id = nullif(current_setting('app.school_id', true), '')::uuid
    AND (nullif(current_setting('app.user_id', true), '') IS NULL OR user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  )
  WITH CHECK (
    school_id = nullif(current_setting('app.school_id', true), '')::uuid
    AND (nullif(current_setting('app.user_id', true), '') IS NULL OR user_id = nullif(current_setting('app.user_id', true), '')::uuid)
  );
