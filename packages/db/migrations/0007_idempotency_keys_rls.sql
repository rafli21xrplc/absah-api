-- Keys are private to the caller that created them (user_id), within the active school.
-- Kiosk devices (prompt 3.1) will use user_id null and are scoped by school only.
ALTER TABLE "idempotency_keys" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_caller ON "idempotency_keys"
  USING (
    school_id = nullif(current_setting('app.school_id', true), '')::uuid
    AND user_id IS NOT DISTINCT FROM nullif(current_setting('app.user_id', true), '')::uuid)
  WITH CHECK (
    school_id = nullif(current_setting('app.school_id', true), '')::uuid
    AND user_id IS NOT DISTINCT FROM nullif(current_setting('app.user_id', true), '')::uuid);
