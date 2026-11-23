CREATE TYPE "public"."tracer_source" AS ENUM('alumni', 'bkk');--> statement-breakpoint
CREATE TYPE "public"."tracer_status" AS ENUM('bekerja', 'melanjutkan', 'wirausaha', 'belum');--> statement-breakpoint
CREATE TABLE "tracer_alumni" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"name" text NOT NULL,
	"nisn" text,
	"graduation_year" smallint NOT NULL,
	"stream" "class_stream",
	"student_id" uuid,
	"phone" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracer_alumni_year_check" CHECK ("tracer_alumni"."graduation_year" between 1990 and 2100)
);
--> statement-breakpoint
CREATE TABLE "tracer_responses" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"alumnus_id" uuid NOT NULL,
	"status" "tracer_status" NOT NULL,
	"organization" text,
	"position" text,
	"source" "tracer_source" NOT NULL,
	"entered_by" uuid,
	"answered_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracer_responses_alumnus_id_key" UNIQUE("alumnus_id")
);
--> statement-breakpoint
ALTER TABLE "tracer_alumni" ADD CONSTRAINT "tracer_alumni_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracer_alumni" ADD CONSTRAINT "tracer_alumni_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracer_alumni" ADD CONSTRAINT "tracer_alumni_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracer_responses" ADD CONSTRAINT "tracer_responses_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracer_responses" ADD CONSTRAINT "tracer_responses_alumnus_id_tracer_alumni_id_fk" FOREIGN KEY ("alumnus_id") REFERENCES "public"."tracer_alumni"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracer_responses" ADD CONSTRAINT "tracer_responses_entered_by_user_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tracer_alumni_school_id_student_id_key" ON "tracer_alumni" USING btree ("school_id","student_id") WHERE "tracer_alumni"."student_id" is not null;--> statement-breakpoint
CREATE INDEX "tracer_alumni_school_id_year_idx" ON "tracer_alumni" USING btree ("school_id","graduation_year");--> statement-breakpoint
CREATE INDEX "tracer_responses_school_id_idx" ON "tracer_responses" USING btree ("school_id");