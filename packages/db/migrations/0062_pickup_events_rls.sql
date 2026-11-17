-- pickup_events: tenant table, RLS like every other. No TRUNCATE.
ALTER TABLE "pickup_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "pickup_events" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "pickup_events"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
-- WhatsApp template for parents at check-out (GRB-10): first name, the penjemput's name and the time.
-- approval stays 'pending' until the provider approves it.
INSERT INTO "message_templates" ("id", "code", "language", "body", "params", "provider_name", "approval") VALUES
  (gen_random_uuid(), 'student_picked_up', 'id',
   '{{school}}: {{first_name}} dijemput oleh {{pickup_name}} pukul {{time}}. Detail: {{link}}',
   ARRAY['school', 'first_name', 'pickup_name', 'time', 'link'], 'absah_student_picked_up_v1', 'pending')
ON CONFLICT ("code", "language") DO NOTHING;
