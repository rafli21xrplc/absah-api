-- App role: every tenant transaction runs `set_config('role', 'absah_app', true)` in withTenant,
-- so RLS applies even when the login role owns the tables. absah_app never gets BYPASSRLS.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'absah_app') THEN
    CREATE ROLE absah_app NOLOGIN NOBYPASSRLS;
  END IF;
END $$;--> statement-breakpoint

-- The login role must be allowed to SET ROLE absah_app (Postgres 16 does not grant this
-- automatically to the role that created it).
DO $$
BEGIN
  IF NOT pg_has_role(current_user, 'absah_app', 'MEMBER') THEN
    EXECUTE format('GRANT absah_app TO %I', current_user);
  END IF;
END $$;--> statement-breakpoint

GRANT USAGE ON SCHEMA public TO absah_app;--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO absah_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO absah_app;--> statement-breakpoint
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO absah_app;--> statement-breakpoint

-- schools: the row is the tenant, so compare id (not school_id).
ALTER TABLE "schools" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "schools"
  USING (id = current_setting('app.school_id')::uuid)
  WITH CHECK (id = current_setting('app.school_id')::uuid);
