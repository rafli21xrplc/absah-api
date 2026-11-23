CREATE TYPE "public"."counseling_follow_up" AS ENUM('none', 'planned', 'done');--> statement-breakpoint
CREATE TABLE "counseling_notes" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"session_date" date NOT NULL,
	"note" text NOT NULL,
	"follow_up" "counseling_follow_up" DEFAULT 'none' NOT NULL,
	"follow_up_on" date,
	"followed_up_at" timestamp with time zone,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "counseling_notes_follow_up_on_check" CHECK ("counseling_notes"."follow_up_on" is null or "counseling_notes"."follow_up" in ('planned', 'done')),
	CONSTRAINT "counseling_notes_done_check" CHECK (("counseling_notes"."follow_up" = 'done') = ("counseling_notes"."followed_up_at" is not null))
);
--> statement-breakpoint
ALTER TABLE "counseling_notes" ADD CONSTRAINT "counseling_notes_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counseling_notes" ADD CONSTRAINT "counseling_notes_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "counseling_notes" ADD CONSTRAINT "counseling_notes_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "counseling_notes_school_id_enrollment_id_idx" ON "counseling_notes" USING btree ("school_id","enrollment_id","session_date");--> statement-breakpoint
CREATE INDEX "counseling_notes_school_id_planned_idx" ON "counseling_notes" USING btree ("school_id","follow_up_on") WHERE "counseling_notes"."follow_up" = 'planned';