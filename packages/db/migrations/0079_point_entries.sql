CREATE TABLE "point_entries" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"rule_id" uuid NOT NULL,
	"kind" "point_kind" NOT NULL,
	"category" text NOT NULL,
	"rule_name" text NOT NULL,
	"points" smallint NOT NULL,
	"occurred_on" date NOT NULL,
	"note" text,
	"evidence_key" text,
	"evidence_type" text,
	"reverses_entry_id" uuid,
	"recorded_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "point_entries_points_check" CHECK ("point_entries"."points" between -100 and 100 and "point_entries"."points" <> 0),
	CONSTRAINT "point_entries_sign_check" CHECK ("point_entries"."reverses_entry_id" is not null or ("point_entries"."kind" = 'violation' and "point_entries"."points" < 0) or ("point_entries"."kind" = 'achievement' and "point_entries"."points" > 0)),
	CONSTRAINT "point_entries_evidence_check" CHECK (("point_entries"."evidence_key" is null) = ("point_entries"."evidence_type" is null))
);
--> statement-breakpoint
ALTER TABLE "point_entries" ADD CONSTRAINT "point_entries_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_entries" ADD CONSTRAINT "point_entries_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_entries" ADD CONSTRAINT "point_entries_rule_id_point_rules_id_fk" FOREIGN KEY ("rule_id") REFERENCES "public"."point_rules"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_entries" ADD CONSTRAINT "point_entries_recorded_by_user_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "point_entries" ADD CONSTRAINT "point_entries_reverses_entry_id_fkey" FOREIGN KEY ("reverses_entry_id") REFERENCES "public"."point_entries"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "point_entries_school_id_enrollment_id_idx" ON "point_entries" USING btree ("school_id","enrollment_id","occurred_on");--> statement-breakpoint
CREATE UNIQUE INDEX "point_entries_reverses_entry_id_key" ON "point_entries" USING btree ("reverses_entry_id") WHERE "point_entries"."reverses_entry_id" is not null;