-- Industry supervisors (PKL-01) are told by WhatsApp where to log in. absah_app cannot read "user",
-- so this narrow view (owned by the migration role) gives the number of the CURRENT school's
-- industry supervisors only.
CREATE VIEW "pkl_mentor_contacts" WITH (security_barrier = true) AS
  SELECT DISTINCT u.id AS user_id, u.phone_number
    FROM "pkl_placements" p
    JOIN "user" u ON u.id = p.industry_mentor_id
   WHERE p.school_id = nullif(current_setting('app.school_id', true), '')::uuid;--> statement-breakpoint
REVOKE ALL ON "pkl_mentor_contacts" FROM absah_app;--> statement-breakpoint
GRANT SELECT ON "pkl_mentor_contacts" TO absah_app;--> statement-breakpoint

-- No student names: the supervisor sees them after logging in. approval stays 'pending' until the
-- provider approves it.
INSERT INTO "message_templates" ("id", "code", "language", "body", "params", "provider_name", "approval") VALUES
  (gen_random_uuid(), 'pkl_mentor_assigned', 'id',
   '{{school}}: Anda ditunjuk sebagai pembimbing industri PKL untuk {{count}} siswa. Masuk dengan nomor WhatsApp ini di {{url}} untuk mengonfirmasi kehadiran mereka.',
   ARRAY['school', 'count', 'url'], 'absah_pkl_mentor_assigned_v1', 'pending')
ON CONFLICT ("code", "language") DO NOTHING;
