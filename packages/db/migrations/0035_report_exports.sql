CREATE TYPE "public"."export_format" AS ENUM('xlsx', 'pdf');--> statement-breakpoint
CREATE TYPE "public"."export_status" AS ENUM('queued', 'done', 'failed', 'expired');--> statement-breakpoint
CREATE TYPE "public"."export_target" AS ENUM('erapor', 'rdm');--> statement-breakpoint
CREATE TABLE "export_jobs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"target" "export_target" NOT NULL,
	"format" "export_format" NOT NULL,
	"semester_id" uuid NOT NULL,
	"class_id" uuid,
	"status" "export_status" DEFAULT 'queued' NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text,
	"error" text,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_semester_id_semesters_id_fk" FOREIGN KEY ("semester_id") REFERENCES "public"."semesters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "export_jobs" ADD CONSTRAINT "export_jobs_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "export_jobs_school_id_requested_by_idx" ON "export_jobs" USING btree ("school_id","requested_by","created_at");--> statement-breakpoint
CREATE INDEX "export_jobs_school_id_status_idx" ON "export_jobs" USING btree ("school_id","status","finished_at");