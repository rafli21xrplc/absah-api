-- WhatsApp template for parents when UKS sends a student home (KSW-08). First name and time only:
-- never the complaint. approval stays 'pending' until the provider approves it.
INSERT INTO "message_templates" ("id", "code", "language", "body", "params", "provider_name", "approval") VALUES
  (gen_random_uuid(), 'student_sent_home', 'id',
   '{{school}}: {{first_name}} dipulangkan dari UKS pukul {{time}} karena kurang sehat. Mohon dijemput atau pastikan sampai di rumah. Detail: {{link}}',
   ARRAY['school', 'first_name', 'time', 'link'], 'absah_student_sent_home_v1', 'pending')
ON CONFLICT ("code", "language") DO NOTHING;
