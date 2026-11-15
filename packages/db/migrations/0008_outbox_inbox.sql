CREATE TABLE "inbox_webhooks" (
	"id" uuid PRIMARY KEY NOT NULL,
	"provider" text NOT NULL,
	"external_id" text NOT NULL,
	"payload" jsonb NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "inbox_webhooks_provider_external_id_key" UNIQUE("provider","external_id")
);
--> statement-breakpoint
CREATE TABLE "outbox_consumptions" (
	"consumer" text NOT NULL,
	"event_id" uuid NOT NULL,
	"school_id" uuid NOT NULL,
	"processed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "outbox_consumptions_pkey" PRIMARY KEY("consumer","event_id")
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"trace_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "outbox_consumptions" ADD CONSTRAINT "outbox_consumptions_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inbox_webhooks_unprocessed_idx" ON "inbox_webhooks" USING btree ("received_at") WHERE "inbox_webhooks"."processed_at" is null;--> statement-breakpoint
CREATE INDEX "outbox_consumptions_school_id_idx" ON "outbox_consumptions" USING btree ("school_id","processed_at");--> statement-breakpoint
CREATE INDEX "outbox_events_school_id_created_at_idx" ON "outbox_events" USING btree ("school_id","created_at");--> statement-breakpoint
CREATE INDEX "outbox_events_unpublished_idx" ON "outbox_events" USING btree ("created_at") WHERE "outbox_events"."published_at" is null;