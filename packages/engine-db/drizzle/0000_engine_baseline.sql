CREATE TABLE "activity_categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"label" text NOT NULL,
	"parent_id" integer,
	"level" integer NOT NULL,
	"service_provider" boolean DEFAULT false NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "activity_categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "captures" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_record_id" bigint NOT NULL,
	"run_id" integer,
	"url" text NOT NULL,
	"http_status" integer,
	"content_type" text,
	"bytes" integer,
	"raw_hash" text NOT NULL,
	"blob_key" text NOT NULL,
	"content_hash" text,
	"parsed" jsonb,
	"parser_version" integer,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "census_snapshots" (
	"id" serial PRIMARY KEY NOT NULL,
	"taken_on" date NOT NULL,
	"source" text NOT NULL,
	"scope" text NOT NULL,
	"expected_total" integer,
	"seen" integer NOT NULL,
	"active" integer,
	"added" integer,
	"gone" integer
);
--> statement-breakpoint
CREATE TABLE "change_events" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_id" uuid,
	"source_record_id" bigint,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"attribute" text,
	"old_value" jsonb,
	"new_value" jsonb,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "classification_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"match" text NOT NULL,
	"is_service_provider" boolean,
	"entity_kind" text,
	"category_id" integer,
	"subcategory_id" integer,
	"tier" integer,
	"priority" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "crawl_runs" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"job" text NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"trigger" text DEFAULT 'manual' NOT NULL,
	"params" jsonb,
	"stats" jsonb,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "cssf_details" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_record_id" bigint NOT NULL,
	"detail_type" text NOT NULL,
	"kind" text NOT NULL,
	"code" text NOT NULL,
	"label" text,
	"lei" text,
	"start_date" date,
	"end_date" date,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "documents" (
	"sha256" text PRIMARY KEY NOT NULL,
	"blob_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"pages" integer,
	"text_status" text DEFAULT 'pending' NOT NULL,
	"text_blob_key" text,
	"downloaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"legal_form" text,
	"status" text DEFAULT 'unknown' NOT NULL,
	"rcs_number" text,
	"lei" text,
	"registered_address" jsonb,
	"registration_date" date,
	"website" text,
	"is_service_provider" boolean DEFAULT false NOT NULL,
	"entity_kind" text DEFAULT 'other' NOT NULL,
	"activity_category_id" integer,
	"activity_subcategory_id" integer,
	"classification_source" text,
	"classified_at" timestamp with time zone,
	"tier" integer DEFAULT 0 NOT NULL,
	"website_provider_id" integer,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "entities_rcs_number_unique" UNIQUE("rcs_number"),
	CONSTRAINT "entities_lei_unique" UNIQUE("lei")
);
--> statement-breakpoint
CREATE TABLE "entity_identifiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"scheme" text NOT NULL,
	"value" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "entity_names" (
	"id" serial PRIMARY KEY NOT NULL,
	"entity_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'legal' NOT NULL,
	"source" text NOT NULL,
	"valid_from" date,
	"valid_to" date
);
--> statement-breakpoint
CREATE TABLE "match_candidates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_record_id" bigint NOT NULL,
	"entity_id" uuid NOT NULL,
	"method" text NOT NULL,
	"score" real NOT NULL,
	"decision" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "observations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"entity_id" uuid,
	"source_record_id" bigint NOT NULL,
	"source" text NOT NULL,
	"attribute" text NOT NULL,
	"value" jsonb,
	"confidence" real DEFAULT 1 NOT NULL,
	"capture_id" bigint,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "rcs_filings" (
	"filing_number" text PRIMARY KEY NOT NULL,
	"source_record_id" bigint NOT NULL,
	"filing_date" date,
	"type" text NOT NULL,
	"details" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"corrects" text,
	"corrected_by" text,
	"has_documents" boolean DEFAULT true NOT NULL,
	"document_sha256" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rcs_number_space" (
	"prefix" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"max_known" integer DEFAULT 0 NOT NULL,
	"swept_to" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_health" (
	"source" text PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'unknown' NOT NULL,
	"message" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_cursors" (
	"source" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "source_cursors_source_key_pk" PRIMARY KEY("source","key")
);
--> statement-breakpoint
CREATE TABLE "source_records" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"entity_id" uuid,
	"state" text DEFAULT 'found' NOT NULL,
	"scope" text,
	"content_hash" text,
	"latest_capture_id" bigint,
	"parsed" jsonb,
	"parser_version" integer,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_fetch_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "activity_categories" ADD CONSTRAINT "activity_categories_parent_id_activity_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."activity_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "captures" ADD CONSTRAINT "captures_run_id_crawl_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."crawl_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "change_events" ADD CONSTRAINT "change_events_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_rules" ADD CONSTRAINT "classification_rules_category_id_activity_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."activity_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "classification_rules" ADD CONSTRAINT "classification_rules_subcategory_id_activity_categories_id_fk" FOREIGN KEY ("subcategory_id") REFERENCES "public"."activity_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cssf_details" ADD CONSTRAINT "cssf_details_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_activity_category_id_activity_categories_id_fk" FOREIGN KEY ("activity_category_id") REFERENCES "public"."activity_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entities" ADD CONSTRAINT "entities_activity_subcategory_id_activity_categories_id_fk" FOREIGN KEY ("activity_subcategory_id") REFERENCES "public"."activity_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_identifiers" ADD CONSTRAINT "entity_identifiers_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_names" ADD CONSTRAINT "entity_names_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_candidates" ADD CONSTRAINT "match_candidates_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match_candidates" ADD CONSTRAINT "match_candidates_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "observations" ADD CONSTRAINT "observations_capture_id_captures_id_fk" FOREIGN KEY ("capture_id") REFERENCES "public"."captures"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcs_filings" ADD CONSTRAINT "rcs_filings_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rcs_filings" ADD CONSTRAINT "rcs_filings_document_sha256_documents_sha256_fk" FOREIGN KEY ("document_sha256") REFERENCES "public"."documents"("sha256") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_records" ADD CONSTRAINT "source_records_entity_id_entities_id_fk" FOREIGN KEY ("entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "activity_categories_parent_idx" ON "activity_categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "captures_record_idx" ON "captures" USING btree ("source_record_id","fetched_at");--> statement-breakpoint
CREATE UNIQUE INDEX "census_snapshots_uq" ON "census_snapshots" USING btree ("taken_on","source","scope");--> statement-breakpoint
CREATE INDEX "change_events_entity_idx" ON "change_events" USING btree ("entity_id","detected_at");--> statement-breakpoint
CREATE INDEX "change_events_kind_idx" ON "change_events" USING btree ("kind","detected_at");--> statement-breakpoint
CREATE INDEX "change_events_detected_idx" ON "change_events" USING btree ("detected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "classification_rules_uq" ON "classification_rules" USING btree ("kind","match");--> statement-breakpoint
CREATE INDEX "crawl_runs_started_idx" ON "crawl_runs" USING btree ("started_at");--> statement-breakpoint
CREATE UNIQUE INDEX "cssf_details_uq" ON "cssf_details" USING btree ("source_record_id","detail_type","code");--> statement-breakpoint
CREATE INDEX "cssf_details_code_idx" ON "cssf_details" USING btree ("code");--> statement-breakpoint
CREATE INDEX "entities_normalized_name_idx" ON "entities" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "entities_kind_idx" ON "entities" USING btree ("entity_kind");--> statement-breakpoint
CREATE INDEX "entities_sp_idx" ON "entities" USING btree ("is_service_provider");--> statement-breakpoint
CREATE INDEX "entities_tier_idx" ON "entities" USING btree ("tier");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_identifiers_scheme_value_uq" ON "entity_identifiers" USING btree ("scheme","value");--> statement-breakpoint
CREATE INDEX "entity_identifiers_entity_idx" ON "entity_identifiers" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "entity_names_uq" ON "entity_names" USING btree ("entity_id","source","name");--> statement-breakpoint
CREATE INDEX "entity_names_entity_idx" ON "entity_names" USING btree ("entity_id");--> statement-breakpoint
CREATE UNIQUE INDEX "match_candidates_uq" ON "match_candidates" USING btree ("source_record_id","entity_id");--> statement-breakpoint
CREATE INDEX "match_candidates_pending_idx" ON "match_candidates" USING btree ("decision");--> statement-breakpoint
CREATE INDEX "observations_open_idx" ON "observations" USING btree ("source_record_id","attribute") WHERE valid_to is null;--> statement-breakpoint
CREATE INDEX "observations_entity_idx" ON "observations" USING btree ("entity_id","attribute");--> statement-breakpoint
CREATE INDEX "rcs_filings_record_idx" ON "rcs_filings" USING btree ("source_record_id","filing_date");--> statement-breakpoint
CREATE INDEX "rcs_filings_doc_todo_idx" ON "rcs_filings" USING btree ("document_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "source_records_source_ext_uq" ON "source_records" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "source_records_entity_idx" ON "source_records" USING btree ("entity_id");--> statement-breakpoint
CREATE INDEX "source_records_due_idx" ON "source_records" USING btree ("source","next_fetch_at");--> statement-breakpoint
CREATE INDEX "source_records_scope_idx" ON "source_records" USING btree ("source","scope");