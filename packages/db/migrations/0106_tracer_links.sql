CREATE TABLE "tracer_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"alumnus_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_opened_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tracer_links" ADD CONSTRAINT "tracer_links_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracer_links" ADD CONSTRAINT "tracer_links_alumnus_id_tracer_alumni_id_fk" FOREIGN KEY ("alumnus_id") REFERENCES "public"."tracer_alumni"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "tracer_links_token_hash_key" ON "tracer_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "tracer_links_school_id_alumnus_id_idx" ON "tracer_links" USING btree ("school_id","alumnus_id");