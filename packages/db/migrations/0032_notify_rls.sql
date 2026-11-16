-- notifications: tenant table, RLS like every other. No TRUNCATE.
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE TRUNCATE ON "notifications" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "notifications"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
-- message_templates: platform data, read-only for the app role (the Absah team edits with the owner role).
REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "message_templates" FROM absah_app;--> statement-breakpoint
-- Starting templates. approval stays 'pending' until the provider approves them; then the Absah team
-- sets approval = 'approved'. Only first name and status; details behind the link.
INSERT INTO "message_templates" ("id", "code", "language", "body", "params", "provider_name", "approval") VALUES
  (gen_random_uuid(), 'absent_marked', 'id',
   '{{school}}: {{first_name}} tercatat tidak hadir tanpa keterangan (alpa) pada {{date}}. Bila keliru atau ada izin, buka {{link}}',
   ARRAY['school', 'first_name', 'date', 'link'], 'absah_absent_marked_v1', 'pending'),
  (gen_random_uuid(), 'leave_approved', 'id',
   '{{school}}: izin {{kind}} untuk {{first_name}} ({{dates}}) disetujui. Detail: {{link}}',
   ARRAY['school', 'kind', 'first_name', 'dates', 'link'], 'absah_leave_approved_v1', 'pending'),
  (gen_random_uuid(), 'leave_rejected', 'id',
   '{{school}}: izin {{kind}} untuk {{first_name}} ({{dates}}) tidak disetujui. Hubungi wali kelas atau buka {{link}}',
   ARRAY['school', 'kind', 'first_name', 'dates', 'link'], 'absah_leave_rejected_v1', 'pending'),
  (gen_random_uuid(), 'login_otp', 'id',
   'Kode masuk Absah: {{code}}. Jangan berikan kode ini kepada siapa pun.',
   ARRAY['code'], 'absah_login_otp_v1', 'pending');
