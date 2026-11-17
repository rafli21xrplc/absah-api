-- WhatsApp template asking parents about an unlisted penjemput at the gate (GRB-10). The link opens
-- the action link page where they allow or deny. approval stays 'pending' until the provider approves it.
INSERT INTO "message_templates" ("id", "code", "language", "body", "params", "provider_name", "approval") VALUES
  (gen_random_uuid(), 'unlisted_pickup', 'id',
   '{{school}}: {{pickup_name}} ingin menjemput {{first_name}} pukul {{time}} tetapi belum terdaftar sebagai penjemput. Anak Anda menunggu di sekolah sampai ada persetujuan. Setujui atau tolak: {{link}}',
   ARRAY['school', 'pickup_name', 'first_name', 'time', 'link'], 'absah_unlisted_pickup_v1', 'pending')
ON CONFLICT ("code", "language") DO NOTHING;
