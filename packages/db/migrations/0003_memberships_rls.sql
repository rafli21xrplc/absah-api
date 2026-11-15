-- Two kinds of scoped transactions exist:
--   withTenant(school, user): app.school_id = school, app.user_id = user (or '')
--   withUser(user):           app.school_id = '',     app.user_id = user  (cross-school lookups for
--                                                                         /me/context only)
-- nullif(current_setting(..., true), '') makes an unset setting match nothing (fail closed).

-- Better Auth tables hold credentials: the app role never touches them. Better Auth uses the
-- login role directly. (Default privileges from 0001 granted DML; take it back.)
REVOKE ALL ON "user", "session", "account", "verification", "two_factor", "rate_limit" FROM absah_app;--> statement-breakpoint

-- memberships: tenant rows, plus a user's own memberships across schools (read only).
ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "memberships"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY own_memberships ON "memberships" FOR SELECT
  USING (user_id = nullif(current_setting('app.user_id', true), '')::uuid);--> statement-breakpoint

-- schools: the active school, plus read access to schools where the user is an active member.
DROP POLICY tenant_isolation ON "schools";--> statement-breakpoint
CREATE POLICY tenant_isolation ON "schools"
  USING (id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY member_read ON "schools" FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM "memberships" m
     WHERE m.school_id = "schools".id
       AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
       AND m.status = 'active'));--> statement-breakpoint

-- Member directory for the active school: names and emails without exposing the user table.
-- Owned by the migration role, so it reads "user" with owner rights; the WHERE clause is the
-- isolation boundary. security_barrier stops predicates leaking rows through planner pushdown.
CREATE VIEW school_member_directory WITH (security_barrier = true) AS
  SELECT m.id AS membership_id, m.school_id, m.user_id, m.role, m.status, m.academic_year_id,
         u.name, u.email
    FROM "memberships" m
    JOIN "user" u ON u.id = m.user_id
   WHERE m.school_id = nullif(current_setting('app.school_id', true), '')::uuid;--> statement-breakpoint
REVOKE ALL ON school_member_directory FROM absah_app;--> statement-breakpoint
GRANT SELECT ON school_member_directory TO absah_app;
