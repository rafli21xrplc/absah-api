CREATE TYPE "public"."slot_owner_type" AS ENUM('class', 'group');--> statement-breakpoint
CREATE TABLE "learning_group_members" (
	"school_id" uuid NOT NULL,
	"learning_group_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_group_members_learning_group_id_enrollment_id_pk" PRIMARY KEY("learning_group_id","enrollment_id")
);
--> statement-breakpoint
CREATE TABLE "learning_groups" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"subject_id" uuid NOT NULL,
	"teacher_id" uuid,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "learning_groups_school_id_year_name_key" UNIQUE("school_id","academic_year_id","name")
);
--> statement-breakpoint
CREATE TABLE "schedule_periods" (
	"school_id" uuid NOT NULL,
	"day" smallint NOT NULL,
	"number" smallint NOT NULL,
	"starts_at" time NOT NULL,
	"ends_at" time NOT NULL,
	CONSTRAINT "schedule_periods_school_id_day_number_pk" PRIMARY KEY("school_id","day","number"),
	CONSTRAINT "schedule_periods_day_check" CHECK ("schedule_periods"."day" between 1 and 7),
	CONSTRAINT "schedule_periods_number_check" CHECK ("schedule_periods"."number" between 0 and 20),
	CONSTRAINT "schedule_periods_time_check" CHECK ("schedule_periods"."starts_at" < "schedule_periods"."ends_at")
);
--> statement-breakpoint
CREATE TABLE "schedule_slots" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"academic_year_id" uuid NOT NULL,
	"owner_type" "slot_owner_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"day" smallint NOT NULL,
	"period" smallint NOT NULL,
	"subject_id" uuid NOT NULL,
	"teacher_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "schedule_slots_owner_time_key" UNIQUE("owner_type","owner_id","day","period"),
	CONSTRAINT "schedule_slots_day_check" CHECK ("schedule_slots"."day" between 1 and 7)
);
--> statement-breakpoint
CREATE TABLE "subjects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"name" text NOT NULL,
	"code" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "subjects_school_id_name_key" UNIQUE("school_id","name")
);
--> statement-breakpoint
ALTER TABLE "learning_group_members" ADD CONSTRAINT "learning_group_members_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_group_members" ADD CONSTRAINT "learning_group_members_learning_group_id_learning_groups_id_fk" FOREIGN KEY ("learning_group_id") REFERENCES "public"."learning_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_group_members" ADD CONSTRAINT "learning_group_members_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_groups" ADD CONSTRAINT "learning_groups_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_groups" ADD CONSTRAINT "learning_groups_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_groups" ADD CONSTRAINT "learning_groups_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "learning_groups" ADD CONSTRAINT "learning_groups_teacher_id_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_periods" ADD CONSTRAINT "schedule_periods_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_academic_year_id_academic_years_id_fk" FOREIGN KEY ("academic_year_id") REFERENCES "public"."academic_years"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_subject_id_subjects_id_fk" FOREIGN KEY ("subject_id") REFERENCES "public"."subjects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedule_slots" ADD CONSTRAINT "schedule_slots_teacher_id_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subjects" ADD CONSTRAINT "subjects_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "learning_group_members_school_id_enrollment_id_idx" ON "learning_group_members" USING btree ("school_id","enrollment_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schedule_slots_teacher_time_key" ON "schedule_slots" USING btree ("school_id","academic_year_id","teacher_id","day","period") WHERE "schedule_slots"."teacher_id" is not null;--> statement-breakpoint
CREATE INDEX "schedule_slots_school_id_year_time_idx" ON "schedule_slots" USING btree ("school_id","academic_year_id","day","period");