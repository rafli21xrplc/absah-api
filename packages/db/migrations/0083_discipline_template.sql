-- WhatsApp template for parents when a student reaches a discipline tier (KSW-03). Generic on purpose:
-- first name only, never the points, the rule or what happened. approval stays 'pending' until the provider approves it.
INSERT INTO "message_templates" ("id", "code", "language", "body", "params", "provider_name", "approval") VALUES
  (gen_random_uuid(), 'student_discipline_threshold', 'id',
   '{{school}}: ada catatan kesiswaan {{first_name}} yang perlu dibicarakan dengan sekolah. Mohon hubungi wali kelas. Detail: {{link}}',
   ARRAY['school', 'first_name', 'link'], 'absah_student_discipline_threshold_v1', 'pending')
ON CONFLICT ("code", "language") DO NOTHING;
