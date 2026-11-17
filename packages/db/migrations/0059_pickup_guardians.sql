CREATE TYPE "public"."pickup_guardian_status" AS ENUM('pending', 'approved', 'rejected', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."pickup_relation" AS ENUM('ayah', 'ibu', 'kakek', 'nenek', 'kakak', 'paman', 'bibi', 'sopir', 'lainnya');--> statement-breakpoint
CREATE TABLE "pickup_guardians" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"name" text NOT NULL,
	"relation" "pickup_relation" NOT NULL,
	"phone" text NOT NULL,
	"photo_key" text NOT NULL,
	"photo_removed_at" timestamp with time zone,
	"valid_until" date,
	"status" "pickup_guardian_status" DEFAULT 'pending' NOT NULL,
	"registered_by" uuid,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pickup_guardians" ADD CONSTRAINT "pickup_guardians_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_guardians" ADD CONSTRAINT "pickup_guardians_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_guardians" ADD CONSTRAINT "pickup_guardians_registered_by_user_id_fk" FOREIGN KEY ("registered_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pickup_guardians" ADD CONSTRAINT "pickup_guardians_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pickup_guardians_school_id_student_id_idx" ON "pickup_guardians" USING btree ("school_id","student_id");--> statement-breakpoint
CREATE INDEX "pickup_guardians_school_id_status_idx" ON "pickup_guardians" USING btree ("school_id","status");