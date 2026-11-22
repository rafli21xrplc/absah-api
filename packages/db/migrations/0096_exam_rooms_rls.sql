-- exam_rooms / exam_seats: tenant tables with RLS. A room's name, capacity and pengawas can change; a seat can move to
-- another room or number. Both may be deleted (a room made by mistake, a student taken out), but never truncated.
ALTER TABLE "exam_rooms" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "exam_seats" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
REVOKE UPDATE, TRUNCATE ON "exam_rooms", "exam_seats" FROM absah_app;--> statement-breakpoint
GRANT UPDATE ("name", "capacity", "supervisor_id") ON "exam_rooms" TO absah_app;--> statement-breakpoint
GRANT UPDATE ("room_id", "seat_no") ON "exam_seats" TO absah_app;--> statement-breakpoint
CREATE POLICY tenant_isolation ON "exam_rooms"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY tenant_isolation ON "exam_seats"
  USING (school_id = nullif(current_setting('app.school_id', true), '')::uuid)
  WITH CHECK (school_id = nullif(current_setting('app.school_id', true), '')::uuid);
