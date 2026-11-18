CREATE SCHEMA "tppk";
--> statement-breakpoint
CREATE TYPE "tppk"."case_status" AS ENUM('open', 'closed');--> statement-breakpoint
CREATE TYPE "tppk"."event_kind" AS ENUM('catatan', 'langkah', 'ditutup', 'dibuka_kembali');--> statement-breakpoint
CREATE TYPE "tppk"."report_category" AS ENUM('fisik', 'psikis', 'perundungan', 'seksual', 'diskriminasi', 'kebijakan', 'lainnya');--> statement-breakpoint
CREATE TYPE "tppk"."report_status" AS ENUM('diterima', 'ditangani', 'selesai');--> statement-breakpoint
CREATE TYPE "tppk"."reporter_relation" AS ENUM('siswa', 'orang_tua', 'guru', 'tenaga_kependidikan', 'lainnya');--> statement-breakpoint
CREATE TABLE "tppk"."case_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"case_id" uuid NOT NULL,
	"kind" "tppk"."event_kind" NOT NULL,
	"note" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tppk"."cases" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"report_id" uuid,
	"summary" text NOT NULL,
	"status" "tppk"."case_status" DEFAULT 'open' NOT NULL,
	"opened_by" uuid,
	"closed_at" timestamp with time zone,
	"closed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tppk_cases_report_id_key" UNIQUE("report_id")
);
--> statement-breakpoint
CREATE TABLE "tppk"."members" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"appointed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tppk_members_school_id_user_id_key" UNIQUE("school_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "tppk"."reports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"category" "tppk"."report_category" NOT NULL,
	"chronology" text NOT NULL,
	"occurred_on" date,
	"reporter_relation" "tppk"."reporter_relation" NOT NULL,
	"is_anonymous" boolean NOT NULL,
	"reporter_user_id" uuid,
	"reporter_name" text,
	"reporter_contact" text,
	"tracking_code_hash" text NOT NULL,
	"status" "tppk"."report_status" DEFAULT 'diterima' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tppk_reports_tracking_code_hash_key" UNIQUE("tracking_code_hash")
);
--> statement-breakpoint
ALTER TABLE "tppk"."case_events" ADD CONSTRAINT "case_events_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tppk"."case_events" ADD CONSTRAINT "case_events_case_id_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "tppk"."cases"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tppk"."case_events" ADD CONSTRAINT "case_events_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tppk"."cases" ADD CONSTRAINT "cases_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tppk"."cases" ADD CONSTRAINT "cases_report_id_reports_id_fk" FOREIGN KEY ("report_id") REFERENCES "tppk"."reports"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tppk"."cases" ADD CONSTRAINT "cases_opened_by_user_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tppk"."cases" ADD CONSTRAINT "cases_closed_by_user_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tppk"."members" ADD CONSTRAINT "members_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tppk"."members" ADD CONSTRAINT "members_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tppk"."members" ADD CONSTRAINT "members_appointed_by_user_id_fk" FOREIGN KEY ("appointed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tppk"."reports" ADD CONSTRAINT "reports_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tppk"."reports" ADD CONSTRAINT "reports_reporter_user_id_user_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tppk_case_events_case_id_created_at_idx" ON "tppk"."case_events" USING btree ("case_id","created_at");--> statement-breakpoint
CREATE INDEX "tppk_cases_school_id_status_idx" ON "tppk"."cases" USING btree ("school_id","status","created_at");--> statement-breakpoint
CREATE INDEX "tppk_reports_school_id_created_at_idx" ON "tppk"."reports" USING btree ("school_id","created_at");