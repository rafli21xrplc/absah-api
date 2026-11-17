CREATE TYPE "public"."uks_outcome" AS ENUM('kembali_kelas', 'istirahat', 'dipulangkan');--> statement-breakpoint
CREATE TABLE "uks_visits" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"school_date" date NOT NULL,
	"visited_at" timestamp with time zone DEFAULT now() NOT NULL,
	"complaint" text NOT NULL,
	"action" text,
	"outcome" "uks_outcome" NOT NULL,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "uks_visits" ADD CONSTRAINT "uks_visits_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uks_visits" ADD CONSTRAINT "uks_visits_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "uks_visits" ADD CONSTRAINT "uks_visits_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "uks_visits_school_id_school_date_idx" ON "uks_visits" USING btree ("school_id","school_date","visited_at");--> statement-breakpoint
CREATE INDEX "uks_visits_school_id_enrollment_id_idx" ON "uks_visits" USING btree ("school_id","enrollment_id","visited_at");