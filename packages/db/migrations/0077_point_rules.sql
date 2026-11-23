CREATE TYPE "public"."point_kind" AS ENUM('violation', 'achievement');--> statement-breakpoint
ALTER TYPE "public"."membership_role" ADD VALUE 'guru_bk' BEFORE 'guru_tahfidz';--> statement-breakpoint
CREATE TABLE "point_rules" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"kind" "point_kind" NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"points" smallint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "point_rules_points_check" CHECK (("point_rules"."kind" = 'violation' and "point_rules"."points" between -100 and -1) or ("point_rules"."kind" = 'achievement' and "point_rules"."points" between 1 and 100))
);
--> statement-breakpoint
ALTER TABLE "point_rules" ADD CONSTRAINT "point_rules_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_rules" ADD CONSTRAINT "point_rules_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "point_rules_school_id_name_key" ON "point_rules" USING btree ("school_id",lower("name"));