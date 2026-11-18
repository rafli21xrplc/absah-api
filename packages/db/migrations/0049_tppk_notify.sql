-- Who on the TPPK can be reached on WhatsApp (KSW-06). absah_app cannot read "user", so this narrow
-- view (owned by the migration role) gives name and phone of the CURRENT school's TPPK members only.
CREATE VIEW "tppk"."member_contacts" WITH (security_barrier = true) AS
  SELECT m.user_id, u.name, u.phone_number
    FROM "tppk"."members" m
    JOIN "user" u ON u.id = m.user_id
   WHERE m.school_id = nullif(current_setting('app.school_id', true), '')::uuid;--> statement-breakpoint
REVOKE ALL ON "tppk"."member_contacts" FROM absah_app;--> statement-breakpoint
GRANT SELECT ON "tppk"."member_contacts" TO absah_app;--> statement-breakpoint

-- Messages to the TPPK members. Nothing about the report itself: no category, no names, no text.
-- approval stays 'pending' until the provider approves them.
INSERT INTO "message_templates" ("id", "code", "language", "body", "params", "provider_name", "approval") VALUES
  (gen_random_uuid(), 'tppk_report_received', 'id',
   '{{school}}: ada laporan baru di kanal TPPK. Buka Absah untuk menanganinya: {{link}}',
   ARRAY['school', 'link'], 'absah_tppk_report_received_v1', 'pending'),
  (gen_random_uuid(), 'tppk_team_changed', 'id',
   '{{school}}: susunan tim TPPK diubah oleh admin. Ditambahkan: {{added}}. Dikeluarkan: {{removed}}. Lihat tim: {{link}}',
   ARRAY['school', 'added', 'removed', 'link'], 'absah_tppk_team_changed_v1', 'pending')
ON CONFLICT ("code", "language") DO NOTHING;
