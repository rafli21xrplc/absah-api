CREATE TABLE "mbg_forecasts" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"class_id" uuid NOT NULL,
	"school_date" date NOT NULL,
	"enrolled" integer NOT NULL,
	"on_leave" integer NOT NULL,
	"off_campus" integer NOT NULL,
	"forecast" integer NOT NULL,
	"sent_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mbg_forecasts_class_date_key" UNIQUE("school_id","class_id","school_date")
);
--> statement-breakpoint
ALTER TABLE "mbg_forecasts" ADD CONSTRAINT "mbg_forecasts_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mbg_forecasts" ADD CONSTRAINT "mbg_forecasts_class_id_classes_id_fk" FOREIGN KEY ("class_id") REFERENCES "public"."classes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mbg_daily_counts" DROP COLUMN "forecast_h3";