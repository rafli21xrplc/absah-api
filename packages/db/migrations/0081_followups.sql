CREATE TYPE "public"."followup_status" AS ENUM('open', 'done');--> statement-breakpoint
CREATE TABLE "followup_tasks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"threshold_id" uuid NOT NULL,
	"label" text NOT NULL,
	"action" text NOT NULL,
	"min_points" smallint NOT NULL,
	"total_points" smallint NOT NULL,
	"status" "followup_status" DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "followup_tasks_done_check" CHECK (("followup_tasks"."status" = 'done') = ("followup_tasks"."completed_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "point_thresholds" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"min_points" smallint NOT NULL,
	"label" text NOT NULL,
	"action" text NOT NULL,
	"notify_parents" boolean DEFAULT true NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "point_thresholds_min_points_check" CHECK ("point_thresholds"."min_points" between 1 and 1000)
);
--> statement-breakpoint
ALTER TABLE "followup_tasks" ADD CONSTRAINT "followup_tasks_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_tasks" ADD CONSTRAINT "followup_tasks_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_tasks" ADD CONSTRAINT "followup_tasks_threshold_id_point_thresholds_id_fk" FOREIGN KEY ("threshold_id") REFERENCES "public"."point_thresholds"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "followup_tasks" ADD CONSTRAINT "followup_tasks_completed_by_user_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_thresholds" ADD CONSTRAINT "point_thresholds_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_thresholds" ADD CONSTRAINT "point_thresholds_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "followup_tasks_enrollment_id_threshold_id_key" ON "followup_tasks" USING btree ("enrollment_id","threshold_id");--> statement-breakpoint
CREATE INDEX "followup_tasks_school_id_status_idx" ON "followup_tasks" USING btree ("school_id","status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "point_thresholds_school_id_min_points_key" ON "point_thresholds" USING btree ("school_id","min_points");