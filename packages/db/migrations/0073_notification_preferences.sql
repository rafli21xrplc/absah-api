CREATE TABLE "notification_preferences" (
	"guardian_id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"muted_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"no_late_messages" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_guardian_id_guardians_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardians"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notification_preferences" ADD CONSTRAINT "notification_preferences_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "notification_preferences_school_id_idx" ON "notification_preferences" USING btree ("school_id");