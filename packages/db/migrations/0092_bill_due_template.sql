-- WhatsApp template for parents when a student bill installment is due within days (TGH-04). Generic on purpose: first
-- name and the date only, never the amount or what it is for. approval stays 'pending' until the provider approves it.
INSERT INTO "message_templates" ("id", "code", "language", "body", "params", "provider_name", "approval") VALUES
  (gen_random_uuid(), 'student_bill_due', 'id',
   '{{school}}: ada tagihan {{first_name}} yang jatuh tempo {{date}}. Detail dan cara bayar: {{link}}',
   ARRAY['school', 'first_name', 'date', 'link'], 'absah_student_bill_due_v1', 'pending')
ON CONFLICT ("code", "language") DO NOTHING;
