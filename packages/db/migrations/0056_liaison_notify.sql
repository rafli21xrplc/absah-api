-- Buku penghubung notifications (ORT-07).
ALTER TABLE "liaison_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "liaison_settings"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint

-- A parent's message reaches the wali kelas. absah_app cannot read "user", so this narrow view
-- (owned by the migration role) gives the phone of the CURRENT school's wali kelas per rombel only.
CREATE VIEW "homeroom_contacts" WITH (security_barrier = true) AS
  SELECT c.id AS class_id, u.id AS user_id, u.phone_number
    FROM "classes" c
    JOIN "user" u ON u.id = c.homeroom_teacher_id
   WHERE c.school_id = nullif(current_setting('app.school_id', true), '')::uuid;--> statement-breakpoint
REVOKE ALL ON "homeroom_contacts" FROM absah_app;--> statement-breakpoint
GRANT SELECT ON "homeroom_contacts" TO absah_app;--> statement-breakpoint

-- Says who wrote about whom, never the text (it may be private; it is read after login).
-- approval stays 'pending' until the provider approves it.
INSERT INTO "message_templates" ("id", "code", "language", "body", "params", "provider_name", "approval") VALUES
  (gen_random_uuid(), 'liaison_message', 'id',
   '{{school}}: pesan baru di buku penghubung {{first_name}} dari {{sender}}. Baca dan balas di Absah: {{url}}',
   ARRAY['school', 'first_name', 'sender', 'url'], 'absah_liaison_message_v1', 'pending')
ON CONFLICT ("code", "language") DO NOTHING;
