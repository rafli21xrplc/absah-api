-- WhatsApp templates for the PIC MBG (RKP-08). Numbers only, no student names. approval stays
-- 'pending' until the provider approves them (then the Absah team sets 'approved').
INSERT INTO "message_templates" ("id", "code", "language", "body", "params", "provider_name", "approval") VALUES
  (gen_random_uuid(), 'mbg_count', 'id',
   '{{school}}: jumlah siswa hadir untuk MBG {{date}} = {{total}} siswa. Per rombel: {{classes}}.',
   ARRAY['school', 'date', 'total', 'classes'], 'absah_mbg_count_v1', 'pending'),
  (gen_random_uuid(), 'mbg_count_corrected', 'id',
   '{{school}}: KOREKSI jumlah siswa hadir untuk MBG {{date}} = {{total}} siswa. Per rombel: {{classes}}. Angka ini menggantikan pesan sebelumnya.',
   ARRAY['school', 'date', 'total', 'classes'], 'absah_mbg_count_corrected_v1', 'pending')
ON CONFLICT ("code", "language") DO NOTHING;
