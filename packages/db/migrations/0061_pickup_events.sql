CREATE TYPE "public"."pickup_event_status" AS ENUM('released', 'held', 'denied', 'expired');--> statement-breakpoint
CREATE TABLE "pickup_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"school_date" date NOT NULL,
	"client_event_id" uuid NOT NULL,
	"kiosk_id" uuid,
	"student_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"pickup_guardian_id" uuid,
	"pickup_name" text NOT NULL,
	"unlisted_photo_key" text,
	"photo_removed_at" timestamp with time zone,
	"status" "pickup_event_status" NOT NULL,
	"checked_out_at" timestamp with time zone,
	"decided_by" uuid,
	"decided_via" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pickup_events_school_id_client_event_id_key" UNIQUE("school_id","client_event_id")
);
--> statement-breakpoint
ALTER TABLE "pickup_events" ADD CONSTRAINT "pickup_events_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_events" ADD CONSTRAINT "pickup_events_kiosk_id_kiosk_devices_id_fk" FOREIGN KEY ("kiosk_id") REFERENCES "public"."kiosk_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_events" ADD CONSTRAINT "pickup_events_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_events" ADD CONSTRAINT "pickup_events_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_events" ADD CONSTRAINT "pickup_events_pickup_guardian_id_pickup_guardians_id_fk" FOREIGN KEY ("pickup_guardian_id") REFERENCES "public"."pickup_guardians"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_events" ADD CONSTRAINT "pickup_events_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pickup_events_released_key" ON "pickup_events" USING btree ("school_id","enrollment_id","school_date") WHERE "pickup_events"."status" = 'released';--> statement-breakpoint
CREATE INDEX "pickup_events_school_id_school_date_idx" ON "pickup_events" USING btree ("school_id","school_date");