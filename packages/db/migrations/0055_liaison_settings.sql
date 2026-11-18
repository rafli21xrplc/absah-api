CREATE TABLE "liaison_settings" (
	"school_id" uuid PRIMARY KEY NOT NULL,
	"starts_at" time DEFAULT '06:00' NOT NULL,
	"ends_at" time DEFAULT '18:00' NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "liaison_settings" ADD CONSTRAINT "liaison_settings_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liaison_settings" ADD CONSTRAINT "liaison_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;