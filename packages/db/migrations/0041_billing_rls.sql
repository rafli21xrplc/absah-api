-- invoices, invoice_lines, payments: tenant tables with RLS. Financial records: the app role never
-- deletes invoices or their lines.
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "invoices" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "invoices"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "invoice_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "invoice_lines" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "invoice_lines"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE DELETE, TRUNCATE ON "payments" FROM absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "payments"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
-- calendar_days.billing_exempt is set by the Absah team only (owner role). The app role may keep
-- managing holidays but can neither set nor clear the flag, nor delete an exempt day.
CREATE FUNCTION calendar_days_guard_billing_exempt() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF current_user = 'absah_app' THEN
    IF TG_OP = 'INSERT' AND NEW.billing_exempt THEN
      RAISE EXCEPTION 'billing_exempt is set by the Absah team only' USING ERRCODE = '42501';
    ELSIF TG_OP = 'UPDATE' AND NEW.billing_exempt IS DISTINCT FROM OLD.billing_exempt THEN
      RAISE EXCEPTION 'billing_exempt is set by the Absah team only' USING ERRCODE = '42501';
    ELSIF TG_OP = 'DELETE' AND OLD.billing_exempt THEN
      RAISE EXCEPTION 'billing exempt days are removed by the Absah team only' USING ERRCODE = '42501';
    END IF;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER calendar_days_guard_billing_exempt BEFORE INSERT OR UPDATE OR DELETE ON "calendar_days"
  FOR EACH ROW EXECUTE FUNCTION calendar_days_guard_billing_exempt();
