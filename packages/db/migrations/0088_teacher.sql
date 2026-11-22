CREATE TYPE "public"."teacher_attendance_source" AS ENUM('app', 'kiosk');--> statement-breakpoint
CREATE TYPE "public"."teacher_leave_kind" AS ENUM('sakit', 'izin', 'dinas');--> statement-breakpoint
CREATE TABLE "session_substitutions" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"session_id" uuid NOT NULL,
	"from_teacher_id" uuid,
	"substitute_id" uuid NOT NULL,
	"assigned_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "teacher_attendance" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"school_date" date NOT NULL,
	"checked_in_at" timestamp with time zone NOT NULL,
	"checked_out_at" timestamp with time zone,
	"late" boolean DEFAULT false NOT NULL,
	"source" "teacher_attendance_source" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_attendance_out_after_in_check" CHECK ("teacher_attendance"."checked_out_at" is null or "teacher_attendance"."checked_out_at" >= "teacher_attendance"."checked_in_at")
);
--> statement-breakpoint
CREATE TABLE "teacher_leaves" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "teacher_leave_kind" NOT NULL,
	"starts_on" date NOT NULL,
	"ends_on" date NOT NULL,
	"reason" text NOT NULL,
	"status" "leave_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "teacher_leaves_range_check" CHECK ("teacher_leaves"."ends_on" >= "teacher_leaves"."starts_on")
);
--> statement-breakpoint
ALTER TABLE "session_substitutions" ADD CONSTRAINT "session_substitutions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_substitutions" ADD CONSTRAINT "session_substitutions_session_id_attendance_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."attendance_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_substitutions" ADD CONSTRAINT "session_substitutions_from_teacher_id_user_id_fk" FOREIGN KEY ("from_teacher_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_substitutions" ADD CONSTRAINT "session_substitutions_substitute_id_user_id_fk" FOREIGN KEY ("substitute_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_substitutions" ADD CONSTRAINT "session_substitutions_assigned_by_user_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_attendance" ADD CONSTRAINT "teacher_attendance_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_attendance" ADD CONSTRAINT "teacher_attendance_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_leaves" ADD CONSTRAINT "teacher_leaves_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_leaves" ADD CONSTRAINT "teacher_leaves_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teacher_leaves" ADD CONSTRAINT "teacher_leaves_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "session_substitutions_school_id_session_id_idx" ON "session_substitutions" USING btree ("school_id","session_id");--> statement-breakpoint
CREATE INDEX "session_substitutions_school_id_substitute_id_idx" ON "session_substitutions" USING btree ("school_id","substitute_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "teacher_attendance_user_date_key" ON "teacher_attendance" USING btree ("school_id","user_id","school_date");--> statement-breakpoint
CREATE INDEX "teacher_attendance_school_id_date_idx" ON "teacher_attendance" USING btree ("school_id","school_date");--> statement-breakpoint
CREATE INDEX "teacher_leaves_school_id_status_idx" ON "teacher_leaves" USING btree ("school_id","status");--> statement-breakpoint
CREATE INDEX "teacher_leaves_school_id_user_id_idx" ON "teacher_leaves" USING btree ("school_id","user_id");--> statement-breakpoint
CREATE INDEX "teacher_leaves_school_id_approved_idx" ON "teacher_leaves" USING btree ("school_id","starts_on","ends_on") WHERE "teacher_leaves"."status" = 'approved';