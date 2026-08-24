CREATE TYPE "public"."billing_mode" AS ENUM('anniversary', 'fixed_day');--> statement-breakpoint
CREATE TYPE "public"."card_brand" AS ENUM('Visa', 'Mastercard', 'Amex', 'Diners', 'Unknown');--> statement-breakpoint
CREATE TYPE "public"."charge_status" AS ENUM('pending', 'succeeded', 'failed');--> statement-breakpoint
CREATE TYPE "public"."charge_type" AS ENUM('renewal', 'proration', 'enrollment', 'drop_in', 'saas');--> statement-breakpoint
CREATE TYPE "public"."check_in_method" AS ENUM('qr', 'manual');--> statement-breakpoint
CREATE TYPE "public"."membership_status" AS ENUM('active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."payment_rail" AS ENUM('card', 'yape', 'cash', 'bank_transfer');--> statement-breakpoint
CREATE TYPE "public"."plan_type" AS ENUM('unlimited', 'sessions_per_week', 'fixed_days');--> statement-breakpoint
CREATE TYPE "public"."quota_overflow_policy" AS ENUM('block', 'offer_drop_in');--> statement-breakpoint
CREATE TYPE "public"."saas_tier" AS ENUM('up_to_60', 'up_to_150', 'unlimited');--> statement-breakpoint
CREATE TYPE "public"."staff_role" AS ENUM('owner', 'front_desk');--> statement-breakpoint
CREATE TYPE "public"."subscription_status" AS ENUM('active', 'in_grace', 'suspended', 'canceled');--> statement-breakpoint
CREATE TYPE "public"."tenant_status" AS ENUM('active', 'suspended');--> statement-breakpoint
CREATE TABLE "attendance" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"subscription_id" uuid NOT NULL,
	"class_schedule_id" uuid,
	"checked_in_at" timestamp with time zone DEFAULT now() NOT NULL,
	"local_date" date NOT NULL,
	"iso_week" text NOT NULL,
	"method" "check_in_method" NOT NULL,
	"device_id" uuid,
	"recorded_by" uuid,
	"overrode_denial" boolean DEFAULT false NOT NULL,
	"denial_reason" jsonb,
	"synced_at" timestamp with time zone,
	"client_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "charges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"subscription_id" uuid,
	"membership_id" uuid NOT NULL,
	"type" charge_type NOT NULL,
	"amount_cents" integer NOT NULL,
	"status" charge_status NOT NULL,
	"rail" "payment_rail" NOT NULL,
	"culqi_charge_id" text,
	"error_code" text,
	"attempt" smallint DEFAULT 1 NOT NULL,
	"period_start" date,
	"period_end" date,
	"recorded_by" uuid,
	"client_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "checkin_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"totp_secret_encrypted" text,
	"active" boolean DEFAULT true NOT NULL,
	"last_seen_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "class_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"weekday" smallint NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"capacity" smallint,
	"instructor" text,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"tenant_id" uuid NOT NULL,
	"internal_alias" text,
	"status" "membership_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payment_methods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"culqi_customer_id" text NOT NULL,
	"culqi_card_id" text NOT NULL,
	"brand" "card_brand" DEFAULT 'Unknown' NOT NULL,
	"last4" text NOT NULL,
	"exp_month" smallint NOT NULL,
	"exp_year" smallint NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "plan_type" NOT NULL,
	"sessions_per_week" smallint,
	"allowed_days" smallint[],
	"price_cents" integer NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staff" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" "staff_role" NOT NULL,
	"display_name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"tenant_id" uuid NOT NULL,
	"membership_id" uuid NOT NULL,
	"plan_id" uuid NOT NULL,
	"pending_plan_id" uuid,
	"status" "subscription_status" DEFAULT 'active' NOT NULL,
	"start_date" date NOT NULL,
	"period_start" date NOT NULL,
	"next_billing_date" date NOT NULL,
	"canceled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenant_gateway" (
	"tenant_id" uuid PRIMARY KEY NOT NULL,
	"culqi_public_key" text,
	"culqi_secret_key_encrypted" text,
	"active" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tenants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"tax_id" text NOT NULL,
	"slug" text NOT NULL,
	"timezone" text DEFAULT 'America/Lima' NOT NULL,
	"saas_tier" "saas_tier" DEFAULT 'up_to_60' NOT NULL,
	"grace_days" smallint DEFAULT 5 NOT NULL,
	"billing_mode" "billing_mode" DEFAULT 'anniversary' NOT NULL,
	"billing_day_of_month" smallint,
	"quota_overflow_policy" "quota_overflow_policy" DEFAULT 'block' NOT NULL,
	"drop_in_price_cents" integer,
	"status" "tenant_status" DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"document_id" text NOT NULL,
	"email" text,
	"phone" text NOT NULL,
	"photo_url" text,
	"totp_secret_encrypted" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"culqi_event_id" text NOT NULL,
	"type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"processed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_class_schedule_id_class_schedules_id_fk" FOREIGN KEY ("class_schedule_id") REFERENCES "public"."class_schedules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "attendance" ADD CONSTRAINT "attendance_recorded_by_staff_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_subscription_id_subscriptions_id_fk" FOREIGN KEY ("subscription_id") REFERENCES "public"."subscriptions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "charges" ADD CONSTRAINT "charges_recorded_by_staff_id_fk" FOREIGN KEY ("recorded_by") REFERENCES "public"."staff"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "checkin_devices" ADD CONSTRAINT "checkin_devices_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "class_schedules" ADD CONSTRAINT "class_schedules_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plans" ADD CONSTRAINT "plans_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff" ADD CONSTRAINT "staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_membership_id_memberships_id_fk" FOREIGN KEY ("membership_id") REFERENCES "public"."memberships"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_pending_plan_id_plans_id_fk" FOREIGN KEY ("pending_plan_id") REFERENCES "public"."plans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tenant_gateway" ADD CONSTRAINT "tenant_gateway_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "attendance_tenant_idx" ON "attendance" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "attendance_membership_week_idx" ON "attendance" USING btree ("membership_id","iso_week");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_once_per_day" ON "attendance" USING btree ("membership_id","local_date");--> statement-breakpoint
CREATE UNIQUE INDEX "attendance_client_id_key" ON "attendance" USING btree ("tenant_id","client_id") WHERE client_id is not null;--> statement-breakpoint
CREATE INDEX "charges_tenant_idx" ON "charges" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "charges_membership_idx" ON "charges" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "charges_subscription_idx" ON "charges" USING btree ("subscription_id");--> statement-breakpoint
CREATE UNIQUE INDEX "charges_renewal_once_per_period" ON "charges" USING btree ("subscription_id","period_start") WHERE type = 'renewal' and status = 'succeeded';--> statement-breakpoint
CREATE UNIQUE INDEX "charges_client_id_key" ON "charges" USING btree ("tenant_id","client_id") WHERE client_id is not null;--> statement-breakpoint
CREATE INDEX "checkin_devices_tenant_idx" ON "checkin_devices" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "class_schedules_tenant_weekday_idx" ON "class_schedules" USING btree ("tenant_id","weekday");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_user_tenant_key" ON "memberships" USING btree ("user_id","tenant_id");--> statement-breakpoint
CREATE INDEX "memberships_tenant_idx" ON "memberships" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "payment_methods_membership_idx" ON "payment_methods" USING btree ("membership_id");--> statement-breakpoint
CREATE INDEX "plans_tenant_idx" ON "plans" USING btree ("tenant_id");--> statement-breakpoint
CREATE UNIQUE INDEX "staff_tenant_user_key" ON "staff" USING btree ("tenant_id","user_id");--> statement-breakpoint
CREATE INDEX "staff_tenant_idx" ON "staff" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "subscriptions_tenant_idx" ON "subscriptions" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX "subscriptions_membership_idx" ON "subscriptions" USING btree ("membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "subscriptions_one_live_per_membership" ON "subscriptions" USING btree ("membership_id") WHERE status <> 'canceled';--> statement-breakpoint
CREATE INDEX "subscriptions_next_billing_idx" ON "subscriptions" USING btree ("next_billing_date");--> statement-breakpoint
CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "tenants_billing_mode_idx" ON "tenants" USING btree ("billing_mode");--> statement-breakpoint
CREATE UNIQUE INDEX "users_phone_key" ON "users" USING btree ("phone");--> statement-breakpoint
CREATE UNIQUE INDEX "users_document_key" ON "users" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_events_culqi_event_key" ON "webhook_events" USING btree ("culqi_event_id");