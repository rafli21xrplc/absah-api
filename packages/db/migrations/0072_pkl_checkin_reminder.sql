-- A PKL student who has not checked in by 10.00 is reminded on their own login number (PKL-02).
-- absah_app cannot read "user", so this narrow view (owned by the migration role) gives the login
-- number of the CURRENT school's students that have a PWA login only.
CREATE VIEW "student_login_contacts" WITH (security_barrier = true) AS
  SELECT s.id AS student_id, u.phone_number
    FROM "students" s
    JOIN "user" u ON u.id = s.user_id
   WHERE s.school_id = nullif(current_setting('app.school_id', true), '')::uuid;--> statement-breakpoint
REVOKE ALL ON "student_login_contacts" FROM absah_app;--> statement-breakpoint
GRANT SELECT ON "student_login_contacts" TO absah_app;--> statement-breakpoint

-- approval stays 'pending' until the provider approves it.
INSERT INTO "message_templates" ("id", "code", "language", "body", "params", "provider_name", "approval") VALUES
  (gen_random_uuid(), 'pkl_checkin_missing', 'id',
   '{{school}}: {{first_name}}, kamu belum check-in PKL hari ini di {{partner}}. Check-in sekarang: {{url}}',
   ARRAY['school', 'first_name', 'partner', 'url'], 'absah_pkl_checkin_missing_v1', 'pending')
ON CONFLICT ("code", "language") DO NOTHING;
