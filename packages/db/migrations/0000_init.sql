CREATE TYPE "public"."school_level" AS ENUM('sd', 'smp', 'sma', 'smk');--> statement-breakpoint
CREATE TABLE "collections" (
	"id" uuid PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schools" (
	"id" uuid PRIMARY KEY NOT NULL,
	"collection_id" uuid,
	"name" text NOT NULL,
	"timezone" text DEFAULT 'Asia/Jakarta' NOT NULL,
	"level" "school_level" NOT NULL,
	"is_madrasah" boolean DEFAULT false NOT NULL,
	"npsn" text,
	"nsm" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "schools" ADD CONSTRAINT "schools_collection_id_collections_id_fk" FOREIGN KEY ("collection_id") REFERENCES "public"."collections"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "schools_collection_id_idx" ON "schools" USING btree ("collection_id");--> statement-breakpoint
CREATE UNIQUE INDEX "schools_npsn_key" ON "schools" USING btree ("npsn");--> statement-breakpoint
CREATE UNIQUE INDEX "schools_nsm_key" ON "schools" USING btree ("nsm");