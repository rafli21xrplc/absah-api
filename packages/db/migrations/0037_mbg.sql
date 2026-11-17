CREATE TABLE "mbg_daily_counts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"school_date" date NOT NULL,
	"enrolled" integer NOT NULL,
	"present_at_cutoff" integer NOT NULL,
	"unrecorded" integer NOT NULL,
	"forecast_h3" integer,
	"sent_at" timestamp with time zone,
	"supersedes_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "mbg_settings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"cutoff_time" time DEFAULT '08:30' NOT NULL,
	"pic_name" text,
	"pic_phone" text,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mbg_settings_school_id_key" UNIQUE("school_id")
);
--> statement-breakpoint
ALTER TABLE "mbg_daily_counts" ADD CONSTRAINT "mbg_daily_counts_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mbg_daily_counts" ADD CONSTRAINT "mbg_daily_counts_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mbg_daily_counts" ADD CONSTRAINT "mbg_daily_counts_supersedes_id_mbg_daily_counts_id_fk" FOREIGN KEY ("supersedes_id") REFERENCES "public"."mbg_daily_counts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mbg_daily_counts" ADD CONSTRAINT "mbg_daily_counts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mbg_settings" ADD CONSTRAINT "mbg_settings_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mbg_settings" ADD CONSTRAINT "mbg_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mbg_daily_counts_school_id_school_date_idx" ON "mbg_daily_counts" USING btree ("school_id","school_date","class_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mbg_daily_counts_cutoff_key" ON "mbg_daily_counts" USING btree ("school_id","class_id","school_date") WHERE "mbg_daily_counts"."supersedes_id" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "mbg_daily_counts_supersedes_key" ON "mbg_daily_counts" USING btree ("school_id","supersedes_id") WHERE "mbg_daily_counts"."supersedes_id" is not null;