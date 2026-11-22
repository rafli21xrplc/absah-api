CREATE TABLE "exam_rooms" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"name" text NOT NULL,
	"capacity" smallint,
	"supervisor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_rooms_period_name_key" UNIQUE("period_id","name"),
	CONSTRAINT "exam_rooms_id_period_key" UNIQUE("id","period_id"),
	CONSTRAINT "exam_rooms_capacity_check" CHECK ("exam_rooms"."capacity" is null or "exam_rooms"."capacity" > 0)
);
--> statement-breakpoint
CREATE TABLE "exam_seats" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"period_id" uuid NOT NULL,
	"room_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"seat_no" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_seats_period_enrollment_key" UNIQUE("period_id","enrollment_id"),
	CONSTRAINT "exam_seats_room_seat_key" UNIQUE("room_id","seat_no")
);
--> statement-breakpoint
ALTER TABLE "exam_rooms" ADD CONSTRAINT "exam_rooms_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_rooms" ADD CONSTRAINT "exam_rooms_period_id_exam_periods_id_fk" FOREIGN KEY ("period_id") REFERENCES "public"."exam_periods"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_rooms" ADD CONSTRAINT "exam_rooms_supervisor_id_user_id_fk" FOREIGN KEY ("supervisor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_seats" ADD CONSTRAINT "exam_seats_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_seats" ADD CONSTRAINT "exam_seats_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_seats" ADD CONSTRAINT "exam_seats_room_period_fk" FOREIGN KEY ("room_id","period_id") REFERENCES "public"."exam_rooms"("id","period_id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exam_rooms_school_id_period_id_idx" ON "exam_rooms" USING btree ("school_id","period_id");--> statement-breakpoint
CREATE INDEX "exam_seats_school_id_room_id_idx" ON "exam_seats" USING btree ("school_id","room_id");