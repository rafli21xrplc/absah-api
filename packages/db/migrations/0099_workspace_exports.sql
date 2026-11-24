CREATE TABLE "workspace_exports" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"status" "export_status" DEFAULT 'queued' NOT NULL,
	"include_files" boolean DEFAULT true NOT NULL,
	"include_tppk" boolean DEFAULT false NOT NULL,
	"file_key" text NOT NULL,
	"file_name" text,
	"size_bytes" bigint,
	"table_count" integer,
	"file_count" integer,
	"error" text,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "workspace_exports" ADD CONSTRAINT "workspace_exports_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "workspace_exports" ADD CONSTRAINT "workspace_exports_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_exports_school_id_created_at_idx" ON "workspace_exports" USING btree ("school_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "workspace_exports_one_queued_key" ON "workspace_exports" USING btree ("school_id") WHERE "workspace_exports"."status" = 'queued';