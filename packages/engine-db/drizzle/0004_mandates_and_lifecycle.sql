CREATE TABLE "ops"."mandate_roles" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"exclusive" boolean NOT NULL,
	"regulated" boolean DEFAULT false NOT NULL,
	"applies_to" text DEFAULT 'both' NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."fund_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"event_date" date,
	"date_precision" text DEFAULT 'day' NOT NULL,
	"related_company_id" uuid,
	"source" text NOT NULL,
	"evidence" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."mandate_evidence" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"mandate_id" bigint NOT NULL,
	"source" text NOT NULL,
	"source_record_id" bigint,
	"document_sha256" text,
	"document_date" date,
	"url" text,
	"quote" text,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."mandates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"client_company_id" uuid NOT NULL,
	"provider_company_id" uuid,
	"provider_name" text NOT NULL,
	"provider_lei" text,
	"role" text NOT NULL,
	"exclusive" boolean DEFAULT false NOT NULL,
	"valid_from" date,
	"valid_from_precision" text DEFAULT 'unknown' NOT NULL,
	"valid_to" date,
	"valid_to_precision" text,
	"status" text DEFAULT 'current' NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"decided_by" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."companies" ADD COLUMN "jurisdiction" text DEFAULT 'LU' NOT NULL;--> statement-breakpoint
ALTER TABLE "core"."companies" ADD COLUMN "register_scope" text;--> statement-breakpoint
ALTER TABLE "core"."companies" ADD COLUMN "launch_date" date;--> statement-breakpoint
ALTER TABLE "core"."companies" ADD COLUMN "launch_date_source" text;--> statement-breakpoint
ALTER TABLE "core"."companies" ADD COLUMN "closure_date" date;--> statement-breakpoint
ALTER TABLE "core"."companies" ADD COLUMN "closure_reason" text;--> statement-breakpoint
ALTER TABLE "core"."positions" ADD COLUMN "start_date" date;--> statement-breakpoint
ALTER TABLE "core"."positions" ADD COLUMN "start_precision" text;--> statement-breakpoint
ALTER TABLE "core"."positions" ADD COLUMN "end_date" date;--> statement-breakpoint
ALTER TABLE "core"."positions" ADD COLUMN "end_precision" text;--> statement-breakpoint
ALTER TABLE "core"."positions" ADD COLUMN "location_country" text;--> statement-breakpoint
ALTER TABLE "core"."positions" ADD COLUMN "location_city" text;--> statement-breakpoint
ALTER TABLE "core"."positions" ADD COLUMN "function" text;--> statement-breakpoint
ALTER TABLE "core"."positions" ADD COLUMN "seniority" text;--> statement-breakpoint
ALTER TABLE "core"."fund_events" ADD CONSTRAINT "fund_events_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "core"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."fund_events" ADD CONSTRAINT "fund_events_related_company_id_companies_id_fk" FOREIGN KEY ("related_company_id") REFERENCES "core"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."mandate_evidence" ADD CONSTRAINT "mandate_evidence_mandate_id_mandates_id_fk" FOREIGN KEY ("mandate_id") REFERENCES "core"."mandates"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."mandate_evidence" ADD CONSTRAINT "mandate_evidence_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "staging"."source_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."mandates" ADD CONSTRAINT "mandates_client_company_id_companies_id_fk" FOREIGN KEY ("client_company_id") REFERENCES "core"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."mandates" ADD CONSTRAINT "mandates_provider_company_id_companies_id_fk" FOREIGN KEY ("provider_company_id") REFERENCES "core"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fund_events_company_idx" ON "core"."fund_events" USING btree ("company_id","event_date");--> statement-breakpoint
CREATE INDEX "fund_events_kind_idx" ON "core"."fund_events" USING btree ("kind","event_date");--> statement-breakpoint
CREATE UNIQUE INDEX "mandate_evidence_uq" ON "core"."mandate_evidence" USING btree ("mandate_id","source","document_date");--> statement-breakpoint
CREATE INDEX "mandates_client_idx" ON "core"."mandates" USING btree ("client_company_id","role");--> statement-breakpoint
CREATE INDEX "mandates_provider_idx" ON "core"."mandates" USING btree ("provider_company_id","role");--> statement-breakpoint
CREATE INDEX "mandates_provider_lei_idx" ON "core"."mandates" USING btree ("provider_lei");--> statement-breakpoint
CREATE INDEX "mandates_current_idx" ON "core"."mandates" USING btree ("role") WHERE status = 'current';--> statement-breakpoint
CREATE INDEX "companies_launch_idx" ON "core"."companies" USING btree ("launch_date");