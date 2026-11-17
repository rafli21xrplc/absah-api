-- Prakiraan MBG H-3 (RKP-09): tenant RLS; what the PIC received never changes.
ALTER TABLE "mbg_forecasts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "mbg_forecasts" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "mbg_forecasts"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint

-- One line to the PIC MBG at 13.00, three days ahead. approval stays 'pending' until the provider approves it.
INSERT INTO "message_templates" ("id", "code", "language", "body", "params", "provider_name", "approval") VALUES
  (gen_random_uuid(), 'mbg_forecast', 'id',
   '{{school}}: prakiraan porsi MBG untuk {{date}}: {{total}} siswa. Per rombel: {{classes}}. Angka hadir final dikirim pada hari itu.',
   ARRAY['school', 'date', 'total', 'classes'], 'absah_mbg_forecast_v1', 'pending')
ON CONFLICT ("code", "language") DO NOTHING;
