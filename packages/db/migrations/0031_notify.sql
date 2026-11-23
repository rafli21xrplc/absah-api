CREATE TYPE "public"."notification_status" AS ENUM('queued', 'sent', 'delivered', 'read', 'failed');--> statement-breakpoint
CREATE TYPE "public"."template_approval" AS ENUM('draft', 'pending', 'approved', 'rejected');--> statement-breakpoint
CREATE TABLE "message_templates" (
	"id" uuid PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"language" text DEFAULT 'id' NOT NULL,
	"body" text NOT NULL,
	"params" text[] NOT NULL,
	"provider_name" text NOT NULL,
	"approval" "template_approval" DEFAULT 'draft' NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_templates_code_language_key" UNIQUE("code","language")
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"dedup_key" text NOT NULL,
	"event_id" uuid,
	"guardian_id" uuid,
	"enrollment_id" uuid,
	"template_code" text NOT NULL,
	"language" text DEFAULT 'id' NOT NULL,
	"to_phone" text NOT NULL,
	"params" text NOT NULL,
	"status" "notification_status" DEFAULT 'queued' NOT NULL,
	"scheduled_for" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"provider_message_id" text,
	"sent_at" timestamp with time zone,
	"delivered_at" timestamp with time zone,
	"read_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "notifications_school_id_dedup_key_key" UNIQUE("school_id","dedup_key")
);
--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_guardian_id_guardians_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardians"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notifications_school_id_status_created_at_idx" ON "notifications" USING btree ("school_id","status","created_at");--> statement-breakpoint
CREATE INDEX "notifications_school_id_unreleased_idx" ON "notifications" USING btree ("school_id","scheduled_for") WHERE "notifications"."released_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_provider_message_id_key" ON "notifications" USING btree ("provider_message_id") WHERE "notifications"."provider_message_id" is not null;