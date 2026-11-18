CREATE TYPE "public"."pkl_checkin_kind" AS ENUM('in', 'out');--> statement-breakpoint
CREATE TYPE "public"."pkl_confirm_status" AS ENUM('pending', 'confirmed', 'needs_review', 'disputed', 'decided');--> statement-breakpoint
CREATE TYPE "public"."pkl_journal_status" AS ENUM('submitted', 'approved', 'revision');--> statement-breakpoint
CREATE TYPE "public"."pkl_placement_status" AS ENUM('active', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."pkl_review_reason" AS ENUM('outside_radius', 'outside_hours', 'clock_skew', 'no_industry_mentor');--> statement-breakpoint
CREATE TABLE "dudi_partners" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"name" text NOT NULL,
	"address" text NOT NULL,
	"latitude" double precision NOT NULL,
	"longitude" double precision NOT NULL,
	"radius_m" integer DEFAULT 150 NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "dudi_partners_school_id_name_key" UNIQUE("school_id","name"),
	CONSTRAINT "dudi_partners_latitude_check" CHECK ("dudi_partners"."latitude" between -90 and 90),
	CONSTRAINT "dudi_partners_longitude_check" CHECK ("dudi_partners"."longitude" between -180 and 180),
	CONSTRAINT "dudi_partners_radius_check" CHECK ("dudi_partners"."radius_m" between 25 and 2000)
);
--> statement-breakpoint
CREATE TABLE "dudi_work_hours" (
	"school_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"day" smallint NOT NULL,
	"starts_at" time NOT NULL,
	"ends_at" time NOT NULL,
	CONSTRAINT "dudi_work_hours_partner_id_day_pk" PRIMARY KEY("partner_id","day"),
	CONSTRAINT "dudi_work_hours_day_check" CHECK ("dudi_work_hours"."day" between 1 and 7),
	CONSTRAINT "dudi_work_hours_range_check" CHECK ("dudi_work_hours"."starts_at" < "dudi_work_hours"."ends_at")
);
--> statement-breakpoint
CREATE TABLE "pkl_checkins" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"placement_id" uuid NOT NULL,
	"school_date" date NOT NULL,
	"kind" "pkl_checkin_kind" NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	"device_time" timestamp with time zone NOT NULL,
	"latitude" numeric(6, 4) NOT NULL,
	"longitude" numeric(7, 4) NOT NULL,
	"accuracy_m" integer,
	"distance_m" integer NOT NULL,
	"review_reasons" "pkl_review_reason"[] DEFAULT '{}' NOT NULL,
	"late" boolean DEFAULT false NOT NULL,
	"confirm_status" "pkl_confirm_status",
	"confirmed_at" timestamp with time zone,
	"confirmed_by" uuid,
	"disputed_at" timestamp with time zone,
	"disputed_by" uuid,
	"dispute_reason" text,
	"decided_status" text,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pkl_checkins_placement_id_school_date_kind_key" UNIQUE("placement_id","school_date","kind"),
	CONSTRAINT "pkl_checkins_confirm_status_check" CHECK (("pkl_checkins"."kind" = 'in') = ("pkl_checkins"."confirm_status" is not null)),
	CONSTRAINT "pkl_checkins_decided_check" CHECK (("pkl_checkins"."confirm_status" = 'decided') = ("pkl_checkins"."decided_status" is not null)),
	CONSTRAINT "pkl_checkins_decided_status_check" CHECK ("pkl_checkins"."decided_status" in ('H', 'S', 'I', 'A', 'T'))
);
--> statement-breakpoint
CREATE TABLE "pkl_journals" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"placement_id" uuid NOT NULL,
	"school_date" date NOT NULL,
	"activity" text NOT NULL,
	"competency" text,
	"attachment_key" text,
	"attachment_type" text,
	"status" "pkl_journal_status" DEFAULT 'submitted' NOT NULL,
	"review_note" text,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pkl_journals_placement_id_school_date_key" UNIQUE("placement_id","school_date"),
	CONSTRAINT "pkl_journals_attachment_check" CHECK (("pkl_journals"."attachment_key" is null) = ("pkl_journals"."attachment_type" is null))
);
--> statement-breakpoint
CREATE TABLE "pkl_placements" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"partner_id" uuid NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"school_mentor_id" uuid,
	"industry_mentor_id" uuid,
	"status" "pkl_placement_status" DEFAULT 'active' NOT NULL,
	"cancelled_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pkl_placements_dates_check" CHECK ("pkl_placements"."starts_on" <= "pkl_placements"."ends_on")
);
--> statement-breakpoint
ALTER TABLE "dudi_partners" ADD CONSTRAINT "dudi_partners_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dudi_partners" ADD CONSTRAINT "dudi_partners_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dudi_work_hours" ADD CONSTRAINT "dudi_work_hours_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dudi_work_hours" ADD CONSTRAINT "dudi_work_hours_partner_id_dudi_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."dudi_partners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pkl_checkins" ADD CONSTRAINT "pkl_checkins_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pkl_checkins" ADD CONSTRAINT "pkl_checkins_placement_id_pkl_placements_id_fk" FOREIGN KEY ("placement_id") REFERENCES "public"."pkl_placements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pkl_checkins" ADD CONSTRAINT "pkl_checkins_confirmed_by_user_id_fk" FOREIGN KEY ("confirmed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pkl_checkins" ADD CONSTRAINT "pkl_checkins_disputed_by_user_id_fk" FOREIGN KEY ("disputed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pkl_checkins" ADD CONSTRAINT "pkl_checkins_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pkl_journals" ADD CONSTRAINT "pkl_journals_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pkl_journals" ADD CONSTRAINT "pkl_journals_placement_id_pkl_placements_id_fk" FOREIGN KEY ("placement_id") REFERENCES "public"."pkl_placements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pkl_journals" ADD CONSTRAINT "pkl_journals_reviewed_by_user_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pkl_placements" ADD CONSTRAINT "pkl_placements_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pkl_placements" ADD CONSTRAINT "pkl_placements_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pkl_placements" ADD CONSTRAINT "pkl_placements_partner_id_dudi_partners_id_fk" FOREIGN KEY ("partner_id") REFERENCES "public"."dudi_partners"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pkl_placements" ADD CONSTRAINT "pkl_placements_school_mentor_id_user_id_fk" FOREIGN KEY ("school_mentor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pkl_placements" ADD CONSTRAINT "pkl_placements_industry_mentor_id_user_id_fk" FOREIGN KEY ("industry_mentor_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pkl_placements" ADD CONSTRAINT "pkl_placements_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dudi_work_hours_school_id_partner_id_idx" ON "dudi_work_hours" USING btree ("school_id","partner_id");--> statement-breakpoint
CREATE INDEX "pkl_checkins_school_id_school_date_idx" ON "pkl_checkins" USING btree ("school_id","school_date");--> statement-breakpoint
CREATE INDEX "pkl_checkins_school_id_confirm_status_idx" ON "pkl_checkins" USING btree ("school_id","confirm_status");--> statement-breakpoint
CREATE INDEX "pkl_journals_school_id_school_date_idx" ON "pkl_journals" USING btree ("school_id","school_date");--> statement-breakpoint
CREATE INDEX "pkl_placements_school_id_enrollment_id_idx" ON "pkl_placements" USING btree ("school_id","enrollment_id");--> statement-breakpoint
CREATE INDEX "pkl_placements_school_id_partner_id_idx" ON "pkl_placements" USING btree ("school_id","partner_id");--> statement-breakpoint
CREATE INDEX "pkl_placements_school_id_school_mentor_id_idx" ON "pkl_placements" USING btree ("school_id","school_mentor_id");--> statement-breakpoint
CREATE INDEX "pkl_placements_school_id_industry_mentor_id_idx" ON "pkl_placements" USING btree ("school_id","industry_mentor_id");--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_pkl_placement_id_pkl_placements_id_fk" FOREIGN KEY ("pkl_placement_id") REFERENCES "public"."pkl_placements"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_sessions_pkl_date_key" ON "attendance_sessions" USING btree ("school_id","school_date","pkl_placement_id") WHERE "attendance_sessions"."mode" = 'pkl';