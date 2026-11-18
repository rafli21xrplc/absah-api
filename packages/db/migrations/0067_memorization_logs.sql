ALTER TYPE "public"."membership_role" ADD VALUE 'guru_tahfidz' BEFORE 'tppk';--> statement-breakpoint
CREATE TABLE "memorization_logs" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"school_date" date NOT NULL,
	"surah" smallint NOT NULL,
	"juz" smallint,
	"ayat_from" smallint NOT NULL,
	"ayat_to" smallint NOT NULL,
	"score" smallint,
	"note" text,
	"listener_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "memorization_logs_surah_check" CHECK ("memorization_logs"."surah" between 1 and 114),
	CONSTRAINT "memorization_logs_juz_check" CHECK ("memorization_logs"."juz" is null or "memorization_logs"."juz" between 1 and 30),
	CONSTRAINT "memorization_logs_ayat_check" CHECK ("memorization_logs"."ayat_from" >= 1 and "memorization_logs"."ayat_to" >= "memorization_logs"."ayat_from"),
	CONSTRAINT "memorization_logs_score_check" CHECK ("memorization_logs"."score" is null or "memorization_logs"."score" between 0 and 100)
);
--> statement-breakpoint
ALTER TABLE "memorization_logs" ADD CONSTRAINT "memorization_logs_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memorization_logs" ADD CONSTRAINT "memorization_logs_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memorization_logs" ADD CONSTRAINT "memorization_logs_listener_id_user_id_fk" FOREIGN KEY ("listener_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "memorization_logs_school_id_student_id_school_date_idx" ON "memorization_logs" USING btree ("school_id","student_id","school_date");