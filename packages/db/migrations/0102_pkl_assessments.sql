-- PKL-04: aspects, assessments, scores. (The snapshot also holds the export_target value added by 0101.)
CREATE TABLE "pkl_assessment_aspects" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"weight" smallint DEFAULT 1 NOT NULL,
	"position" smallint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pkl_assessment_aspects_weight_check" CHECK ("pkl_assessment_aspects"."weight" between 1 and 10)
);
--> statement-breakpoint
CREATE TABLE "pkl_assessment_scores" (
	"school_id" uuid NOT NULL,
	"assessment_id" uuid NOT NULL,
	"aspect_id" uuid NOT NULL,
	"aspect_name" text NOT NULL,
	"weight" smallint NOT NULL,
	"score" smallint NOT NULL,
	CONSTRAINT "pkl_assessment_scores_assessment_id_aspect_id_pk" PRIMARY KEY("assessment_id","aspect_id"),
	CONSTRAINT "pkl_assessment_scores_score_check" CHECK ("pkl_assessment_scores"."score" between 0 and 100)
);
--> statement-breakpoint
CREATE TABLE "pkl_assessments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"placement_id" uuid NOT NULL,
	"assessed_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "pkl_assessments_placement_id_key" UNIQUE("placement_id")
);
--> statement-breakpoint
ALTER TABLE "pkl_assessment_aspects" ADD CONSTRAINT "pkl_assessment_aspects_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pkl_assessment_scores" ADD CONSTRAINT "pkl_assessment_scores_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pkl_assessment_scores" ADD CONSTRAINT "pkl_assessment_scores_assessment_id_pkl_assessments_id_fk" FOREIGN KEY ("assessment_id") REFERENCES "public"."pkl_assessments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pkl_assessment_scores" ADD CONSTRAINT "pkl_assessment_scores_aspect_id_pkl_assessment_aspects_id_fk" FOREIGN KEY ("aspect_id") REFERENCES "public"."pkl_assessment_aspects"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pkl_assessments" ADD CONSTRAINT "pkl_assessments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pkl_assessments" ADD CONSTRAINT "pkl_assessments_placement_id_pkl_placements_id_fk" FOREIGN KEY ("placement_id") REFERENCES "public"."pkl_placements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pkl_assessments" ADD CONSTRAINT "pkl_assessments_assessed_by_user_id_fk" FOREIGN KEY ("assessed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "pkl_assessment_aspects_school_id_name_key" ON "pkl_assessment_aspects" USING btree ("school_id",lower("name")) WHERE "pkl_assessment_aspects"."active";--> statement-breakpoint
CREATE INDEX "pkl_assessment_scores_school_id_idx" ON "pkl_assessment_scores" USING btree ("school_id");--> statement-breakpoint
CREATE INDEX "pkl_assessments_school_id_idx" ON "pkl_assessments" USING btree ("school_id");