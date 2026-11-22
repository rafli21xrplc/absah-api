CREATE TABLE "exam_attendance" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"method" text NOT NULL,
	"recorded_by" uuid,
	CONSTRAINT "exam_attendance_period_enrollment_key" UNIQUE("period_id","enrollment_id"),
	CONSTRAINT "exam_attendance_method_check" CHECK ("exam_attendance"."method" in ('qr', 'manual'))
);
--> statement-breakpoint
ALTER TABLE "exam_attendance" ADD CONSTRAINT "exam_attendance_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_attendance" ADD CONSTRAINT "exam_attendance_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_attendance" ADD CONSTRAINT "exam_attendance_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_attendance" ADD CONSTRAINT "exam_attendance_room_period_fk" FOREIGN KEY ("room_id","period_id") REFERENCES "public"."exam_rooms"("id","period_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exam_attendance_school_id_room_id_idx" ON "exam_attendance" USING btree ("school_id","room_id");