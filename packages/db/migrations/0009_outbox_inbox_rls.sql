-- outbox_events: request code may only append, in its own school. The relay (withPlatform)
-- reads and marks rows; nothing in a tenant transaction reads them back.
ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE SELECT, UPDATE, DELETE, TRUNCATE ON "outbox_events" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_insert ON "outbox_events" FOR INSERT
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint

-- outbox_consumptions: written by consumers inside withTenant(event.schoolId).
ALTER TABLE "outbox_consumptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "outbox_consumptions" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "outbox_consumptions"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint

-- inbox_webhooks: platform table without a school; the app role never touches it.
ALTER TABLE "inbox_webhooks" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE ALL ON "inbox_webhooks" FROM absah_app;
