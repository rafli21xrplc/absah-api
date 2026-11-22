-- fee_types, student_bills, bill_installments, student_payments: tenant tables, RLS like every other. Money records: the app
-- role never deletes, and only the columns that move through the life of a row can change.
--   fee_types: renamed, repriced, switched off.
--   student_bills: paid or voided, nothing else (the total never changes after issue; void and issue again).
--   bill_installments: paid_at and reminded_at.
--   student_payments: the gateway steps of a payment (the charge, the outcome), never the amount.
ALTER TABLE "fee_types" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "student_bills" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bill_installments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "student_payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "fee_types" FROM absah_app;--> statement-breakpoint
GRANT UPDATE ("name", "kind", "default_amount", "active") ON "fee_types" TO absah_app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "student_bills" FROM absah_app;--> statement-breakpoint
GRANT UPDATE ("status", "paid_at", "voided_at", "void_reason") ON "student_bills" TO absah_app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "bill_installments" FROM absah_app;--> statement-breakpoint
GRANT UPDATE ("paid_at", "reminded_at") ON "bill_installments" TO absah_app;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "student_payments" FROM absah_app;--> statement-breakpoint
GRANT UPDATE ("status", "provider_ref", "va_bank", "va_number", "qr_string", "expires_at", "provider_txn_id", "paid_at", "last_error") ON "student_payments" TO absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "fee_types"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY tenant_isolation ON "student_bills"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY tenant_isolation ON "bill_installments"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY tenant_isolation ON "student_payments"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
