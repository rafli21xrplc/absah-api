CREATE TABLE "exam_periods" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"name" text NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"min_attendance" smallint,
	"attendance_from" date,
	"excused_counts" boolean DEFAULT true NOT NULL,
	"require_paid" boolean DEFAULT false NOT NULL,
	"fee_type_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"closed_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "exam_periods_school_year_name_key" UNIQUE("school_id","academic_year_id","name"),
	CONSTRAINT "exam_periods_dates_check" CHECK ("exam_periods"."ends_on" >= "exam_periods"."starts_on"),
	CONSTRAINT "exam_periods_min_attendance_check" CHECK ("exam_periods"."min_attendance" is null or ("exam_periods"."min_attendance" between 1 and 100))
);
--> statement-breakpoint
ALTER TABLE "exam_periods" ADD CONSTRAINT "exam_periods_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_periods" ADD CONSTRAINT "exam_periods_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "exam_periods" ADD CONSTRAINT "exam_periods_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "exam_periods_school_id_starts_on_idx" ON "exam_periods" USING btree ("school_id","starts_on");