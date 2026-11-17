CREATE TABLE "visitors" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"school_date" date NOT NULL,
	"client_event_id" uuid NOT NULL,
	"kiosk_id" uuid,
	"name" text NOT NULL,
	"organization" text,
	"purpose" text NOT NULL,
	"host_user_id" uuid,
	"photo_key" text,
	"photo_removed_at" timestamp with time zone,
	"arrived_at" timestamp with time zone DEFAULT now() NOT NULL,
	"left_at" timestamp with time zone,
	"left_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "visitors_school_id_client_event_id_key" UNIQUE("school_id","client_event_id")
);
--> statement-breakpoint
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_kiosk_id_kiosk_devices_id_fk" FOREIGN KEY ("kiosk_id") REFERENCES "public"."kiosk_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_host_user_id_user_id_fk" FOREIGN KEY ("host_user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "visitors" ADD CONSTRAINT "visitors_left_by_user_id_fk" FOREIGN KEY ("left_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "visitors_school_id_school_date_idx" ON "visitors" USING btree ("school_id","school_date","arrived_at");