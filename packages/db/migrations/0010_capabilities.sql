CREATE TABLE "platform_flags" (
	"id" uuid PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"value" jsonb NOT NULL,
	"school_id" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_flags_key_school_key" UNIQUE NULLS NOT DISTINCT("key","school_id")
);
--> statement-breakpoint
CREATE TABLE "school_capabilities" (
	"school_id" uuid NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"previous_value" jsonb,
	"effective_from" date,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "school_capabilities_pkey" PRIMARY KEY("school_id","key")
);
--> statement-breakpoint
ALTER TABLE "platform_flags" ADD CONSTRAINT "platform_flags_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "school_capabilities" ADD CONSTRAINT "school_capabilities_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "platform_flags_school_id_idx" ON "platform_flags" USING btree ("school_id");