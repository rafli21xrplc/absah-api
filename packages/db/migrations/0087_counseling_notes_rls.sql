-- counseling_notes (KSW-05): the most private table of the school. RLS answers by role, not only by school:
--   read:   the school's active guru BK and admin
--   insert: the school's active guru BK
--   update: the school's active guru BK, and only follow_up and followed_up_at (column-level GRANT below)
-- The wali kelas, kepsek, wakasek, background jobs (no user) and Absah support see 0 rows. There is no DELETE
-- policy, and absah_app has no DELETE or TRUNCATE. memberships stay readable to a member of the school
-- (0003), which is what the policies look at.
ALTER TABLE "counseling_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE UPDATE, DELETE, TRUNCATE ON "counseling_notes" FROM absah_app;--> statement-breakpoint
GRANT UPDATE ("follow_up", "followed_up_at") ON "counseling_notes" TO absah_app;--> statement-breakpoint
CREATE POLICY counseling_read ON "counseling_notes" FOR SELECT
  USING (
    school_id = nullif(current_setting('app.school_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM "memberships" m
                 WHERE m.school_id = counseling_notes.school_id
                   AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
                   AND m.role IN ('guru_bk', 'admin') AND m.status = 'active')
  );--> statement-breakpoint
CREATE POLICY counseling_insert ON "counseling_notes" FOR INSERT
  WITH CHECK (
    school_id = nullif(current_setting('app.school_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM "memberships" m
                 WHERE m.school_id = counseling_notes.school_id
                   AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
                   AND m.role = 'guru_bk' AND m.status = 'active')
  );--> statement-breakpoint
CREATE POLICY counseling_update ON "counseling_notes" FOR UPDATE
  USING (
    school_id = nullif(current_setting('app.school_id', true), '')::uuid
    AND EXISTS (SELECT 1 FROM "memberships" m
                 WHERE m.school_id = counseling_notes.school_id
                   AND m.user_id = nullif(current_setting('app.user_id', true), '')::uuid
                   AND m.role = 'guru_bk' AND m.status = 'active')
  )
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
