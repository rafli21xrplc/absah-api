CREATE TYPE "public"."early_warning_kind" AS ENUM('consecutive_alpa', 'repeated_late', 'bolos_jam', 'pkl_absence');--> statement-breakpoint
CREATE TABLE "early_warning_runs" (
	"school_id" uuid NOT NULL,
	"school_date" date NOT NULL,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "early_warning_runs_school_id_school_date_pk" PRIMARY KEY("school_id","school_date")
);
--> statement-breakpoint
CREATE TABLE "early_warnings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"kind" "early_warning_kind" NOT NULL,
	"school_date" date NOT NULL,
	"dates" date[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "early_warning_runs" ADD CONSTRAINT "early_warning_runs_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "early_warnings" ADD CONSTRAINT "early_warnings_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "early_warnings" ADD CONSTRAINT "early_warnings_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "early_warnings_enrollment_id_kind_school_date_key" ON "early_warnings" USING btree ("enrollment_id","kind","school_date");--> statement-breakpoint
CREATE INDEX "early_warnings_school_id_school_date_idx" ON "early_warnings" USING btree ("school_id","school_date");