ALTER TABLE "gate_secrets" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "gate_secrets" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "gate_secrets"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "cards" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "cards" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "cards"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "card_devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "card_devices" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "card_devices"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "kiosk_devices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "kiosk_devices" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "kiosk_devices"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "kiosk_pairings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "kiosk_pairings" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "kiosk_pairings"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "gate_scans" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "gate_scans" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "gate_scans"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
-- Scans are an append-only log: no UPDATE or DELETE for the app role.
REVOKE UPDATE, DELETE ON "gate_scans" FROM absah_app;
