CREATE TYPE "public"."attendance_source" AS ENUM('teacher', 'gate', 'leave', 'uks', 'pkl_confirm', 'manual');--> statement-breakpoint
CREATE TYPE "public"."attendance_status" AS ENUM('H', 'S', 'I', 'A', 'T');--> statement-breakpoint
CREATE TYPE "public"."correction_status" AS ENUM('pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."session_mode" AS ENUM('per_period', 'daily', 'activity', 'pkl');--> statement-breakpoint
CREATE TYPE "public"."session_owner_type" AS ENUM('class', 'group', 'activity', 'placement');--> statement-breakpoint
CREATE TYPE "public"."session_status" AS ENUM('open', 'submitted', 'missed', 'locked');--> statement-breakpoint
CREATE TABLE "attendance_days" (
	"school_id" uuid NOT NULL,
	"school_date" date NOT NULL,
	"generated_at" timestamp with time zone,
	"skipped_reason" text,
	"locked_at" timestamp with time zone,
	CONSTRAINT "attendance_days_school_id_school_date_pk" PRIMARY KEY("school_id","school_date")
);
--> statement-breakpoint
CREATE TABLE "attendance_records" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"status" "attendance_status" NOT NULL,
	"source" "attendance_source" NOT NULL,
	"source_ref" uuid,
	"recorded_by" uuid,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "attendance_records_session_enrollment_key" UNIQUE("session_id","enrollment_id")
);
--> statement-breakpoint
CREATE TABLE "attendance_sessions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"school_date" date NOT NULL,
	"mode" "session_mode" NOT NULL,
	"owner_type" "session_owner_type" NOT NULL,
	"owner_id" uuid NOT NULL,
	"slot_id" uuid,
	"teacher_id" uuid,
	"status" "session_status" DEFAULT 'open' NOT NULL,
	"topic" text,
	"activity_id" uuid,
	"pkl_placement_id" uuid,
	"submitted_at" timestamp with time zone,
	"submitted_by" uuid,
	"reminded_at" timestamp with time zone,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "correction_requests" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"from_status" "attendance_status",
	"to_status" "attendance_status" NOT NULL,
	"reason" text NOT NULL,
	"status" "correction_status" DEFAULT 'pending' NOT NULL,
	"requested_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_attendance" (
	"school_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"school_date" date NOT NULL,
	"status" "attendance_status" NOT NULL,
	"computed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_attendance_enrollment_id_school_date_pk" PRIMARY KEY("enrollment_id","school_date")
);
--> statement-breakpoint
ALTER TABLE "attendance_days" ADD CONSTRAINT "attendance_days_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_session_id_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_records" ADD CONSTRAINT "attendance_records_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_slot_id_schedule_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."schedule_slots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_teacher_id_user_id_fk" FOREIGN KEY ("teacher_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance_sessions" ADD CONSTRAINT "attendance_sessions_submitted_by_user_id_fk" FOREIGN KEY ("submitted_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_session_id_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "correction_requests" ADD CONSTRAINT "correction_requests_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_attendance" ADD CONSTRAINT "daily_attendance_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_attendance" ADD CONSTRAINT "daily_attendance_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_records_school_id_enrollment_idx" ON "attendance_records" USING btree ("school_id","enrollment_id");--> statement-breakpoint
CREATE INDEX "attendance_sessions_school_id_date_idx" ON "attendance_sessions" USING btree ("school_id","school_date");--> statement-breakpoint
CREATE INDEX "attendance_sessions_school_id_teacher_date_idx" ON "attendance_sessions" USING btree ("school_id","teacher_id","school_date");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_sessions_slot_date_key" ON "attendance_sessions" USING btree ("school_id","school_date","slot_id") WHERE "attendance_sessions"."slot_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_sessions_daily_owner_key" ON "attendance_sessions" USING btree ("school_id","school_date","owner_type","owner_id") WHERE "attendance_sessions"."mode" = 'daily';--> statement-breakpoint
CREATE INDEX "correction_requests_school_id_status_idx" ON "correction_requests" USING btree ("school_id","status");--> statement-breakpoint
CREATE UNIQUE INDEX "correction_requests_pending_key" ON "correction_requests" USING btree ("session_id","enrollment_id") WHERE "correction_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "daily_attendance_school_id_date_idx" ON "daily_attendance" USING btree ("school_id","school_date");