-- Invitation to the tracer study (PKL-05): school, first name and the link; nothing about the answer. approval stays 'pending'
-- until the provider approves it.
INSERT INTO "message_templates" ("id", "code", "language", "body", "params", "provider_name", "approval") VALUES
  (gen_random_uuid(), 'tracer_invitation', 'id',
   '{{school}}: Halo {{first_name}}, kami ingin tahu kabar alumni. Mohon isi tracer study singkat (bekerja, kuliah, atau usaha) di {{url}}. Terima kasih.',
   ARRAY['school', 'first_name', 'url'], 'absah_tracer_invitation_v1', 'pending')
ON CONFLICT ("code", "language") DO NOTHING;
