CREATE TYPE "public"."import_source" AS ENUM('dapodik', 'emis');--> statement-breakpoint
CREATE TYPE "public"."import_status" AS ENUM('awaiting_upload', 'parsing', 'ready', 'failed', 'committed');--> statement-breakpoint
CREATE TABLE "student_imports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"source" "import_source" NOT NULL,
	"status" "import_status" DEFAULT 'awaiting_upload' NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text NOT NULL,
	"file_size" integer NOT NULL,
	"academic_year" text,
	"error" text,
	"counts" jsonb,
	"preview" text,
	"fingerprint" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"parsed_at" timestamp with time zone,
	"committed_at" timestamp with time zone,
	"committed_by" uuid
);
--> statement-breakpoint
ALTER TABLE "student_imports" ADD CONSTRAINT "student_imports_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "student_imports_school_id_created_at_idx" ON "student_imports" USING btree ("school_id","created_at");