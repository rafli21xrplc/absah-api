CREATE TYPE "public"."habit_code" AS ENUM('bangun_pagi', 'beribadah', 'berolahraga', 'makan_sehat', 'gemar_belajar', 'bermasyarakat', 'tidur_cepat');--> statement-breakpoint
CREATE TABLE "habit_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"school_date" date NOT NULL,
	"habit" "habit_code" NOT NULL,
	"value" boolean NOT NULL,
	"filled_by" uuid,
	"filled_by_role" text NOT NULL,
	"locked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "habit_entries_enrollment_id_school_date_habit_key" UNIQUE("enrollment_id","school_date","habit"),
	CONSTRAINT "habit_entries_filled_by_role_check" CHECK ("habit_entries"."filled_by_role" in ('orang_tua', 'siswa'))
);
--> statement-breakpoint
ALTER TABLE "habit_entries" ADD CONSTRAINT "habit_entries_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habit_entries" ADD CONSTRAINT "habit_entries_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "habit_entries" ADD CONSTRAINT "habit_entries_filled_by_user_id_fk" FOREIGN KEY ("filled_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "habit_entries_school_id_school_date_idx" ON "habit_entries" USING btree ("school_id","school_date");