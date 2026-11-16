CREATE TABLE "action_links" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"guardian_id" uuid NOT NULL,
	"student_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"last_opened_at" timestamp with time zone,
	"write_used_at" timestamp with time zone,
	"leave_request_id" uuid,
	"card_device_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "leave_requests" ADD COLUMN "requested_by_guardian_id" uuid;--> statement-breakpoint
ALTER TABLE "action_links" ADD CONSTRAINT "action_links_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_links" ADD CONSTRAINT "action_links_guardian_id_guardians_id_fk" FOREIGN KEY ("guardian_id") REFERENCES "public"."guardians"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_links" ADD CONSTRAINT "action_links_student_id_students_id_fk" FOREIGN KEY ("student_id") REFERENCES "public"."students"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_links" ADD CONSTRAINT "action_links_leave_request_id_leave_requests_id_fk" FOREIGN KEY ("leave_request_id") REFERENCES "public"."leave_requests"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "action_links" ADD CONSTRAINT "action_links_card_device_id_card_devices_id_fk" FOREIGN KEY ("card_device_id") REFERENCES "public"."card_devices"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "action_links_token_hash_key" ON "action_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "action_links_school_id_expires_at_idx" ON "action_links" USING btree ("school_id","expires_at");--> statement-breakpoint
ALTER TABLE "leave_requests" ADD CONSTRAINT "leave_requests_requested_by_guardian_id_guardians_id_fk" FOREIGN KEY ("requested_by_guardian_id") REFERENCES "public"."guardians"("id") ON DELETE set null ON UPDATE no action;