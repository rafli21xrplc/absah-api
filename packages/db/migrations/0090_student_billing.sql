CREATE TYPE "public"."bill_status" AS ENUM('open', 'paid', 'void');--> statement-breakpoint
CREATE TYPE "public"."fee_kind" AS ENUM('spp', 'kegiatan', 'lainnya');--> statement-breakpoint
ALTER TYPE "public"."membership_role" ADD VALUE 'bendahara' BEFORE 'tppk';--> statement-breakpoint
CREATE TABLE "bill_installments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"bill_id" uuid NOT NULL,
	"number" smallint NOT NULL,
	"amount" bigint NOT NULL,
	"due_on" date NOT NULL,
	"paid_at" timestamp with time zone,
	"reminded_at" timestamp with time zone,
	CONSTRAINT "bill_installments_bill_id_number_key" UNIQUE("bill_id","number"),
	CONSTRAINT "bill_installments_amount_check" CHECK ("bill_installments"."amount" > 0)
);
--> statement-breakpoint
CREATE TABLE "fee_types" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "fee_kind" NOT NULL,
	"default_amount" bigint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fee_types_default_amount_check" CHECK ("fee_types"."default_amount" >= 0)
);
--> statement-breakpoint
CREATE TABLE "student_bills" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"enrollment_id" uuid NOT NULL,
	"fee_type_id" uuid NOT NULL,
	"period" text NOT NULL,
	"title" text NOT NULL,
	"total" bigint NOT NULL,
	"due_on" date NOT NULL,
	"status" "bill_status" DEFAULT 'open' NOT NULL,
	"paid_at" timestamp with time zone,
	"voided_at" timestamp with time zone,
	"void_reason" text,
	"issued_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_bills_enrollment_fee_period_key" UNIQUE("school_id","enrollment_id","fee_type_id","period"),
	CONSTRAINT "student_bills_total_check" CHECK ("student_bills"."total" > 0),
	CONSTRAINT "student_bills_void_check" CHECK (("student_bills"."status" = 'void') = ("student_bills"."voided_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "student_payments" (
	"id" uuid PRIMARY KEY NOT NULL,
	"school_id" uuid NOT NULL,
	"installment_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"method" "payment_method" NOT NULL,
	"status" "payment_status" DEFAULT 'requested' NOT NULL,
	"amount" bigint NOT NULL,
	"provider_ref" text,
	"va_bank" text,
	"va_number" text,
	"qr_string" text,
	"expires_at" timestamp with time zone,
	"provider_txn_id" text,
	"paid_at" timestamp with time zone,
	"last_error" text,
	"requested_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "student_payments_amount_check" CHECK ("student_payments"."amount" > 0)
);
--> statement-breakpoint
ALTER TABLE "bill_installments" ADD CONSTRAINT "bill_installments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bill_installments" ADD CONSTRAINT "bill_installments_bill_id_student_bills_id_fk" FOREIGN KEY ("bill_id") REFERENCES "public"."student_bills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_types" ADD CONSTRAINT "fee_types_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fee_types" ADD CONSTRAINT "fee_types_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_bills" ADD CONSTRAINT "student_bills_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_bills" ADD CONSTRAINT "student_bills_enrollment_id_enrollments_id_fk" FOREIGN KEY ("enrollment_id") REFERENCES "public"."enrollments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_bills" ADD CONSTRAINT "student_bills_fee_type_id_fee_types_id_fk" FOREIGN KEY ("fee_type_id") REFERENCES "public"."fee_types"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_bills" ADD CONSTRAINT "student_bills_issued_by_user_id_fk" FOREIGN KEY ("issued_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_payments" ADD CONSTRAINT "student_payments_school_id_schools_id_fk" FOREIGN KEY ("school_id") REFERENCES "public"."schools"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_payments" ADD CONSTRAINT "student_payments_installment_id_bill_installments_id_fk" FOREIGN KEY ("installment_id") REFERENCES "public"."bill_installments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "student_payments" ADD CONSTRAINT "student_payments_requested_by_user_id_fk" FOREIGN KEY ("requested_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bill_installments_school_id_due_on_idx" ON "bill_installments" USING btree ("school_id","due_on") WHERE "bill_installments"."paid_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "fee_types_school_id_name_key" ON "fee_types" USING btree ("school_id",lower("name"));--> statement-breakpoint
CREATE INDEX "student_bills_school_id_enrollment_id_idx" ON "student_bills" USING btree ("school_id","enrollment_id");--> statement-breakpoint
CREATE INDEX "student_bills_school_id_status_due_on_idx" ON "student_bills" USING btree ("school_id","status","due_on");--> statement-breakpoint
CREATE INDEX "student_payments_school_id_installment_id_idx" ON "student_payments" USING btree ("school_id","installment_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "student_payments_provider_ref_key" ON "student_payments" USING btree ("provider","provider_ref") WHERE "student_payments"."provider_ref" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "student_payments_provider_txn_id_key" ON "student_payments" USING btree ("provider","provider_txn_id") WHERE "student_payments"."provider_txn_id" is not null;