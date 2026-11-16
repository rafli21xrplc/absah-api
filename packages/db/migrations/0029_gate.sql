CREATE TYPE "public"."arrival_outcome" AS ENUM('on_time', 'late');--> statement-breakpoint
CREATE TYPE "public"."card_holder" AS ENUM('student', 'parent');--> statement-breakpoint
CREATE TYPE "public"."scan_method" AS ENUM('qr', 'manual');--> statement-breakpoint
CREATE TYPE "public"."scan_reject_reason" AS ENUM('malformed', 'expired', 'no_key', 'bad_signature', 'unknown_card', 'wrong_device', 'not_enrolled');--> statement-breakpoint
CREATE TYPE "public"."scan_result" AS ENUM('accepted', 'duplicate', 'rejected');--> statement-breakpoint
CREATE TABLE "card_devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"card_id" uuid NOT NULL,
	"holder" "card_holder" NOT NULL,
	"user_id" uuid,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"active_device_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cards_student_id_key" UNIQUE("student_id")
);
--> statement-breakpoint
CREATE TABLE "gate_scans" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"school_date" date NOT NULL,
	"scanned_at" timestamp with time zone NOT NULL,
	"method" "scan_method" NOT NULL,
	"result" "scan_result" NOT NULL,
	"reject_reason" "scan_reject_reason",
	"outcome" "arrival_outcome",
	"enrollment_id" uuid,
	"card_id" uuid,
	"device_id" uuid,
	"kiosk_device_id" uuid,
	"client_event_id" uuid,
	"recorded_by" uuid,
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gate_secrets" (
	"school_id" uuid PRIMARY KEY NOT NULL,
	"secret" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "kiosk_devices" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"name" text NOT NULL,
	"token_hash" text NOT NULL,
	"last_seen_at" timestamp with time zone,
	"last_queue_size" integer,
	"app_version" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "kiosk_pairings" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"secret_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"kiosk_device_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "students" ADD COLUMN "user_id" uuid;--> statement-breakpoint
ALTER TABLE "card_devices" ADD CONSTRAINT "card_devices_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_devices" ADD CONSTRAINT "card_devices_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_devices" ADD CONSTRAINT "card_devices_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_scans" ADD CONSTRAINT "gate_scans_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_scans" ADD CONSTRAINT "gate_scans_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_scans" ADD CONSTRAINT "gate_scans_card_id_cards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."cards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_scans" ADD CONSTRAINT "gate_scans_kiosk_device_id_kiosk_devices_id_fk" FOREIGN KEY ("kiosk_device_id") REFERENCES "public"."kiosk_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_scans" ADD CONSTRAINT "gate_scans_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gate_secrets" ADD CONSTRAINT "gate_secrets_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_devices" ADD CONSTRAINT "kiosk_devices_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_devices" ADD CONSTRAINT "kiosk_devices_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_pairings" ADD CONSTRAINT "kiosk_pairings_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_pairings" ADD CONSTRAINT "kiosk_pairings_kiosk_device_id_kiosk_devices_id_fk" FOREIGN KEY ("kiosk_device_id") REFERENCES "public"."kiosk_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "kiosk_pairings" ADD CONSTRAINT "kiosk_pairings_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_devices_school_id_card_id_idx" ON "card_devices" USING btree ("school_id","card_id");--> statement-breakpoint
CREATE INDEX "cards_school_id_idx" ON "cards" USING btree ("school_id");--> statement-breakpoint
CREATE UNIQUE INDEX "gate_scans_kiosk_client_event_key" ON "gate_scans" USING btree ("kiosk_device_id","client_event_id") WHERE "gate_scans"."client_event_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "gate_scans_arrival_key" ON "gate_scans" USING btree ("enrollment_id","school_date") WHERE "gate_scans"."result" = 'accepted';--> statement-breakpoint
CREATE INDEX "gate_scans_school_id_school_date_idx" ON "gate_scans" USING btree ("school_id","school_date");--> statement-breakpoint
CREATE INDEX "kiosk_devices_school_id_idx" ON "kiosk_devices" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "kiosk_pairings_school_id_idx" ON "kiosk_pairings" USING btree ("school_id");--> statement-breakpoint
ALTER TABLE "students" ADD CONSTRAINT "students_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;