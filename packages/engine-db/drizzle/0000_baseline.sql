CREATE SCHEMA "clean";
--> statement-breakpoint
CREATE SCHEMA "core";
--> statement-breakpoint
CREATE SCHEMA "match";
--> statement-breakpoint
CREATE SCHEMA "ops";
--> statement-breakpoint
CREATE SCHEMA "raw";
--> statement-breakpoint
CREATE SCHEMA "staging";
--> statement-breakpoint
CREATE TABLE "ops"."attribute_precedence" (
	"attribute" text NOT NULL,
	"source" text NOT NULL,
	"rank" integer NOT NULL,
	CONSTRAINT "attribute_precedence_attribute_source_pk" PRIMARY KEY("attribute","source")
);
--> statement-breakpoint
CREATE TABLE "ops"."census_snapshots" (
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
CREATE TABLE "ops"."cursors" (
	"source" text NOT NULL,
	"key" text NOT NULL,
	"value" jsonb,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cursors_source_key_pk" PRIMARY KEY("source","key")
);
--> statement-breakpoint
CREATE TABLE "ops"."lbr_capture_round_items" (
	"round_id" integer NOT NULL,
	"rcs" text NOT NULL,
	"position" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"visited_at" timestamp with time zone,
	"filings_before" integer,
	"filings_after" integer,
	"new_filings" integer DEFAULT 0 NOT NULL,
	"new_documents" integer DEFAULT 0 NOT NULL,
	"error" text,
	CONSTRAINT "lbr_capture_round_items_round_id_rcs_pk" PRIMARY KEY("round_id","rcs")
);
--> statement-breakpoint
CREATE TABLE "ops"."lbr_capture_rounds" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"scope" jsonb NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" text,
	"notes" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "ops"."lbr_number_space" (
	"prefix" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"max_known" integer DEFAULT 0 NOT NULL,
	"swept_to" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."lbr_search_words" (
	"term" text PRIMARY KEY NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"seen" integer DEFAULT 0 NOT NULL,
	"origin" text DEFAULT 'seed' NOT NULL,
	"phase" integer DEFAULT 3 NOT NULL,
	"total" integer,
	"rows" integer,
	"new_numbers" integer,
	"capped" boolean,
	"searched_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."news_feeds" (
	"id" serial PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"url" text NOT NULL,
	"language" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"etag" text,
	"last_modified" text,
	"last_polled_at" timestamp with time zone,
	"last_error" text,
	"articles" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "news_feeds_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "ops"."quality_checks" (
	"code" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text NOT NULL,
	"layer" text NOT NULL,
	"min" real,
	"max" real,
	"enabled" boolean DEFAULT true NOT NULL,
	"sort" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."quality_results" (
	"id" serial PRIMARY KEY NOT NULL,
	"check_code" text NOT NULL,
	"scope" text DEFAULT 'all' NOT NULL,
	"value" real,
	"numerator" integer,
	"denominator" integer,
	"passed" boolean,
	"measured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."review_policies" (
	"id" serial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"scope" text DEFAULT '*' NOT NULL,
	"mode" text DEFAULT 'auto' NOT NULL,
	"conditions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"sample_rate" real DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"note" text,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."runs" (
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
CREATE TABLE "ops"."session_health" (
	"source" text PRIMARY KEY NOT NULL,
	"state" text DEFAULT 'unknown' NOT NULL,
	"message" text,
	"checked_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ops"."sources" (
	"code" text PRIMARY KEY NOT NULL,
	"system" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"acquisition" text NOT NULL,
	"homepage" text,
	"description" text,
	"trust" integer DEFAULT 5 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"refresh_days" jsonb,
	"rate_limit_per_min" integer,
	"compliance_note" text,
	"retention_days" integer,
	"sort" integer DEFAULT 0 NOT NULL,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw"."documents" (
	"sha256" text PRIMARY KEY NOT NULL,
	"blob_key" text NOT NULL,
	"mime" text NOT NULL,
	"bytes" integer NOT NULL,
	"pages" integer,
	"filing_number" text,
	"text_status" text DEFAULT 'pending' NOT NULL,
	"text_blob_key" text,
	"downloaded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "raw"."fetches" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"source_record_id" bigint NOT NULL,
	"run_id" integer,
	"url" text NOT NULL,
	"http_status" integer,
	"content_type" text,
	"bytes" integer,
	"raw_hash" text NOT NULL,
	"blob_key" text NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staging"."parsed_records" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_record_id" bigint NOT NULL,
	"fetch_id" bigint,
	"parser_version" integer NOT NULL,
	"content_hash" text NOT NULL,
	"payload" jsonb NOT NULL,
	"review_status" text DEFAULT 'not_required' NOT NULL,
	"review_reasons" jsonb,
	"review_policy_id" integer,
	"reviewed_by" text,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"edited_payload" jsonb,
	"released_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "staging"."source_records" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source" text NOT NULL,
	"external_id" text NOT NULL,
	"company_id" uuid,
	"state" text DEFAULT 'found' NOT NULL,
	"scope" text,
	"latest_fetch_id" bigint,
	"released_parsed_id" bigint,
	"content_hash" text,
	"released" jsonb,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"next_fetch_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "clean"."articles" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_record_id" bigint NOT NULL,
	"feed_id" integer,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"published_at" timestamp with time zone,
	"author" text,
	"language" text,
	"snippet" text,
	"text_blob_key" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "articles_source_record_id_unique" UNIQUE("source_record_id"),
	CONSTRAINT "articles_url_unique" UNIQUE("url")
);
--> statement-breakpoint
CREATE TABLE "clean"."claims" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" uuid,
	"source_record_id" bigint NOT NULL,
	"source" text NOT NULL,
	"attribute" text NOT NULL,
	"value" jsonb,
	"confidence" real DEFAULT 1 NOT NULL,
	"parsed_record_id" bigint,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "clean"."filings" (
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
CREATE TABLE "clean"."licences" (
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
CREATE TABLE "clean"."rejects" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_record_id" bigint NOT NULL,
	"parsed_record_id" bigint,
	"source" text NOT NULL,
	"attribute" text NOT NULL,
	"value" jsonb,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "clean"."web_pages" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_record_id" bigint NOT NULL,
	"url" text NOT NULL,
	"kind" text DEFAULT 'other' NOT NULL,
	"title" text,
	"text_blob_key" text,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match"."candidates" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"source_record_id" bigint NOT NULL,
	"company_id" uuid NOT NULL,
	"method" text NOT NULL,
	"score" real NOT NULL,
	"decision" text DEFAULT 'pending' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "match"."conflicts" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"attribute" text NOT NULL,
	"values" jsonb NOT NULL,
	"winner" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" text,
	"resolved_at" timestamp with time zone,
	"note" text,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."activity_categories" (
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
CREATE TABLE "core"."changes" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" uuid,
	"source_record_id" bigint,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"attribute" text,
	"old_value" jsonb,
	"new_value" jsonb,
	"actor" text,
	"detected_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."classification_rules" (
	"id" serial PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"match" text NOT NULL,
	"is_service_provider" boolean,
	"company_kind" text,
	"category_id" integer,
	"subcategory_id" integer,
	"tier" integer,
	"priority" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "core"."companies" (
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
	"website_verified_at" timestamp with time zone,
	"description" text,
	"phone" text,
	"email" text,
	"headcount" integer,
	"founded_year" integer,
	"operating_countries" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"services" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"logo" jsonb,
	"is_service_provider" boolean DEFAULT false NOT NULL,
	"company_kind" text DEFAULT 'other' NOT NULL,
	"activity_category_id" integer,
	"activity_subcategory_id" integer,
	"classification_source" text,
	"classified_at" timestamp with time zone,
	"tier" integer DEFAULT 0 NOT NULL,
	"website_provider_id" integer,
	"source_count" integer DEFAULT 0 NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_changed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "companies_rcs_number_unique" UNIQUE("rcs_number"),
	CONSTRAINT "companies_lei_unique" UNIQUE("lei")
);
--> statement-breakpoint
CREATE TABLE "core"."company_identifiers" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"scheme" text NOT NULL,
	"value" text NOT NULL,
	"source" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."company_names" (
	"id" serial PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" text DEFAULT 'legal' NOT NULL,
	"source" text NOT NULL,
	"valid_from" date,
	"valid_to" date
);
--> statement-breakpoint
CREATE TABLE "core"."company_relations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"subject_company_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"object_name" text NOT NULL,
	"object_normalized_name" text NOT NULL,
	"object_company_id" uuid,
	"subcategory_id" integer,
	"source" text NOT NULL,
	"source_record_id" bigint,
	"evidence_url" text,
	"confidence" real DEFAULT 1 NOT NULL,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."field_lineage" (
	"company_id" uuid NOT NULL,
	"attribute" text NOT NULL,
	"claim_id" bigint,
	"source" text NOT NULL,
	"value" jsonb,
	"sources_agreeing" integer DEFAULT 1 NOT NULL,
	"sources_total" integer DEFAULT 1 NOT NULL,
	"decided_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "field_lineage_company_id_attribute_pk" PRIMARY KEY("company_id","attribute")
);
--> statement-breakpoint
CREATE TABLE "core"."news_mentions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"article_id" bigint NOT NULL,
	"company_id" uuid NOT NULL,
	"matched_text" text NOT NULL,
	"confidence" real NOT NULL,
	"decision" text DEFAULT 'auto' NOT NULL,
	"decided_by" text,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."people" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"profile_url" text,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "people_profile_url_unique" UNIQUE("profile_url")
);
--> statement-breakpoint
CREATE TABLE "core"."positions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"person_id" uuid NOT NULL,
	"company_id" uuid NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"role" text DEFAULT 'other' NOT NULL,
	"source" text NOT NULL,
	"source_record_id" bigint,
	"evidence_url" text,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."review_summaries" (
	"company_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"rating" real,
	"review_count" integer,
	"url" text,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "review_summaries_company_id_platform_pk" PRIMARY KEY("company_id","platform")
);
--> statement-breakpoint
CREATE TABLE "core"."row_history" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"table_name" text NOT NULL,
	"row_id" text NOT NULL,
	"op" text NOT NULL,
	"old_row" jsonb,
	"new_row" jsonb,
	"actor" text,
	"changed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "core"."web_presence" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"url" text NOT NULL,
	"handle" text,
	"verified" boolean DEFAULT false NOT NULL,
	"followers" integer,
	"source" text NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ops"."attribute_precedence" ADD CONSTRAINT "attribute_precedence_source_sources_code_fk" FOREIGN KEY ("source") REFERENCES "ops"."sources"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."lbr_capture_round_items" ADD CONSTRAINT "lbr_capture_round_items_round_id_lbr_capture_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "ops"."lbr_capture_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ops"."quality_results" ADD CONSTRAINT "quality_results_check_code_quality_checks_code_fk" FOREIGN KEY ("check_code") REFERENCES "ops"."quality_checks"("code") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw"."fetches" ADD CONSTRAINT "fetches_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "staging"."source_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "raw"."fetches" ADD CONSTRAINT "fetches_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "ops"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staging"."parsed_records" ADD CONSTRAINT "parsed_records_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "staging"."source_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staging"."parsed_records" ADD CONSTRAINT "parsed_records_fetch_id_fetches_id_fk" FOREIGN KEY ("fetch_id") REFERENCES "raw"."fetches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staging"."source_records" ADD CONSTRAINT "source_records_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "core"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clean"."articles" ADD CONSTRAINT "articles_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "staging"."source_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clean"."articles" ADD CONSTRAINT "articles_feed_id_news_feeds_id_fk" FOREIGN KEY ("feed_id") REFERENCES "ops"."news_feeds"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clean"."claims" ADD CONSTRAINT "claims_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "core"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clean"."claims" ADD CONSTRAINT "claims_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "staging"."source_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clean"."claims" ADD CONSTRAINT "claims_parsed_record_id_parsed_records_id_fk" FOREIGN KEY ("parsed_record_id") REFERENCES "staging"."parsed_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clean"."filings" ADD CONSTRAINT "filings_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "staging"."source_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clean"."filings" ADD CONSTRAINT "filings_document_sha256_documents_sha256_fk" FOREIGN KEY ("document_sha256") REFERENCES "raw"."documents"("sha256") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clean"."licences" ADD CONSTRAINT "licences_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "staging"."source_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clean"."rejects" ADD CONSTRAINT "rejects_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "staging"."source_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clean"."rejects" ADD CONSTRAINT "rejects_parsed_record_id_parsed_records_id_fk" FOREIGN KEY ("parsed_record_id") REFERENCES "staging"."parsed_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "clean"."web_pages" ADD CONSTRAINT "web_pages_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "staging"."source_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match"."candidates" ADD CONSTRAINT "candidates_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "staging"."source_records"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match"."candidates" ADD CONSTRAINT "candidates_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "core"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "match"."conflicts" ADD CONSTRAINT "conflicts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "core"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."activity_categories" ADD CONSTRAINT "activity_categories_parent_id_activity_categories_id_fk" FOREIGN KEY ("parent_id") REFERENCES "core"."activity_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."changes" ADD CONSTRAINT "changes_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "core"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."changes" ADD CONSTRAINT "changes_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "staging"."source_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."classification_rules" ADD CONSTRAINT "classification_rules_category_id_activity_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "core"."activity_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."classification_rules" ADD CONSTRAINT "classification_rules_subcategory_id_activity_categories_id_fk" FOREIGN KEY ("subcategory_id") REFERENCES "core"."activity_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."companies" ADD CONSTRAINT "companies_activity_category_id_activity_categories_id_fk" FOREIGN KEY ("activity_category_id") REFERENCES "core"."activity_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."companies" ADD CONSTRAINT "companies_activity_subcategory_id_activity_categories_id_fk" FOREIGN KEY ("activity_subcategory_id") REFERENCES "core"."activity_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."company_identifiers" ADD CONSTRAINT "company_identifiers_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "core"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."company_names" ADD CONSTRAINT "company_names_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "core"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."company_relations" ADD CONSTRAINT "company_relations_subject_company_id_companies_id_fk" FOREIGN KEY ("subject_company_id") REFERENCES "core"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."company_relations" ADD CONSTRAINT "company_relations_object_company_id_companies_id_fk" FOREIGN KEY ("object_company_id") REFERENCES "core"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."company_relations" ADD CONSTRAINT "company_relations_subcategory_id_activity_categories_id_fk" FOREIGN KEY ("subcategory_id") REFERENCES "core"."activity_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."company_relations" ADD CONSTRAINT "company_relations_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "staging"."source_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."field_lineage" ADD CONSTRAINT "field_lineage_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "core"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."field_lineage" ADD CONSTRAINT "field_lineage_claim_id_claims_id_fk" FOREIGN KEY ("claim_id") REFERENCES "clean"."claims"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."news_mentions" ADD CONSTRAINT "news_mentions_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "clean"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."news_mentions" ADD CONSTRAINT "news_mentions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "core"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."positions" ADD CONSTRAINT "positions_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "core"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."positions" ADD CONSTRAINT "positions_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "core"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."positions" ADD CONSTRAINT "positions_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "staging"."source_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."review_summaries" ADD CONSTRAINT "review_summaries_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "core"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."web_presence" ADD CONSTRAINT "web_presence_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "core"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "census_snapshots_uq" ON "ops"."census_snapshots" USING btree ("taken_on","source","scope");--> statement-breakpoint
CREATE INDEX "lbr_capture_round_items_next_idx" ON "ops"."lbr_capture_round_items" USING btree ("round_id","status","position");--> statement-breakpoint
CREATE UNIQUE INDEX "lbr_capture_rounds_one_active_uq" ON "ops"."lbr_capture_rounds" USING btree ("status") WHERE status = 'active';--> statement-breakpoint
CREATE INDEX "lbr_search_words_next_idx" ON "ops"."lbr_search_words" USING btree ("status","phase","seen");--> statement-breakpoint
CREATE INDEX "quality_results_check_idx" ON "ops"."quality_results" USING btree ("check_code","scope","measured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "review_policies_uq" ON "ops"."review_policies" USING btree ("source","scope");--> statement-breakpoint
CREATE INDEX "runs_started_idx" ON "ops"."runs" USING btree ("started_at");--> statement-breakpoint
CREATE INDEX "runs_source_idx" ON "ops"."runs" USING btree ("source","started_at");--> statement-breakpoint
CREATE INDEX "fetches_record_idx" ON "raw"."fetches" USING btree ("source_record_id","fetched_at");--> statement-breakpoint
CREATE INDEX "fetches_fetched_idx" ON "raw"."fetches" USING btree ("fetched_at");--> statement-breakpoint
CREATE INDEX "parsed_records_record_idx" ON "staging"."parsed_records" USING btree ("source_record_id","created_at");--> statement-breakpoint
CREATE INDEX "parsed_records_review_idx" ON "staging"."parsed_records" USING btree ("review_status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "source_records_source_ext_uq" ON "staging"."source_records" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "source_records_company_idx" ON "staging"."source_records" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "source_records_due_idx" ON "staging"."source_records" USING btree ("source","next_fetch_at");--> statement-breakpoint
CREATE INDEX "source_records_scope_idx" ON "staging"."source_records" USING btree ("source","scope");--> statement-breakpoint
CREATE INDEX "articles_published_idx" ON "clean"."articles" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "claims_open_idx" ON "clean"."claims" USING btree ("source_record_id","attribute") WHERE valid_to is null;--> statement-breakpoint
CREATE INDEX "claims_company_idx" ON "clean"."claims" USING btree ("company_id","attribute");--> statement-breakpoint
CREATE INDEX "filings_record_idx" ON "clean"."filings" USING btree ("source_record_id","filing_date");--> statement-breakpoint
CREATE INDEX "filings_doc_todo_idx" ON "clean"."filings" USING btree ("document_sha256");--> statement-breakpoint
CREATE UNIQUE INDEX "licences_uq" ON "clean"."licences" USING btree ("source_record_id","detail_type","code");--> statement-breakpoint
CREATE INDEX "licences_code_idx" ON "clean"."licences" USING btree ("code");--> statement-breakpoint
CREATE INDEX "rejects_created_idx" ON "clean"."rejects" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "rejects_record_idx" ON "clean"."rejects" USING btree ("source_record_id");--> statement-breakpoint
CREATE UNIQUE INDEX "web_pages_uq" ON "clean"."web_pages" USING btree ("source_record_id","url");--> statement-breakpoint
CREATE UNIQUE INDEX "candidates_uq" ON "match"."candidates" USING btree ("source_record_id","company_id");--> statement-breakpoint
CREATE INDEX "candidates_decision_idx" ON "match"."candidates" USING btree ("decision");--> statement-breakpoint
CREATE UNIQUE INDEX "conflicts_uq" ON "match"."conflicts" USING btree ("company_id","attribute");--> statement-breakpoint
CREATE INDEX "conflicts_status_idx" ON "match"."conflicts" USING btree ("status","detected_at");--> statement-breakpoint
CREATE INDEX "activity_categories_parent_idx" ON "core"."activity_categories" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "changes_company_idx" ON "core"."changes" USING btree ("company_id","detected_at");--> statement-breakpoint
CREATE INDEX "changes_kind_idx" ON "core"."changes" USING btree ("kind","detected_at");--> statement-breakpoint
CREATE INDEX "changes_detected_idx" ON "core"."changes" USING btree ("detected_at");--> statement-breakpoint
CREATE UNIQUE INDEX "classification_rules_uq" ON "core"."classification_rules" USING btree ("kind","match");--> statement-breakpoint
CREATE INDEX "companies_normalized_name_idx" ON "core"."companies" USING btree ("normalized_name");--> statement-breakpoint
CREATE INDEX "companies_kind_idx" ON "core"."companies" USING btree ("company_kind");--> statement-breakpoint
CREATE INDEX "companies_sp_idx" ON "core"."companies" USING btree ("is_service_provider");--> statement-breakpoint
CREATE INDEX "companies_tier_idx" ON "core"."companies" USING btree ("tier");--> statement-breakpoint
CREATE INDEX "companies_provider_idx" ON "core"."companies" USING btree ("website_provider_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_identifiers_scheme_value_uq" ON "core"."company_identifiers" USING btree ("scheme","value");--> statement-breakpoint
CREATE INDEX "company_identifiers_company_idx" ON "core"."company_identifiers" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_names_uq" ON "core"."company_names" USING btree ("company_id","source","name");--> statement-breakpoint
CREATE INDEX "company_names_company_idx" ON "core"."company_names" USING btree ("company_id");--> statement-breakpoint
CREATE UNIQUE INDEX "company_relations_uq" ON "core"."company_relations" USING btree ("subject_company_id","kind","object_normalized_name","source");--> statement-breakpoint
CREATE INDEX "company_relations_object_idx" ON "core"."company_relations" USING btree ("object_company_id");--> statement-breakpoint
CREATE INDEX "company_relations_object_name_idx" ON "core"."company_relations" USING btree ("object_normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "news_mentions_uq" ON "core"."news_mentions" USING btree ("article_id","company_id");--> statement-breakpoint
CREATE INDEX "news_mentions_company_idx" ON "core"."news_mentions" USING btree ("company_id","created_at");--> statement-breakpoint
CREATE INDEX "news_mentions_decision_idx" ON "core"."news_mentions" USING btree ("decision");--> statement-breakpoint
CREATE INDEX "people_normalized_name_idx" ON "core"."people" USING btree ("normalized_name");--> statement-breakpoint
CREATE UNIQUE INDEX "positions_uq" ON "core"."positions" USING btree ("person_id","company_id","title","source");--> statement-breakpoint
CREATE INDEX "positions_company_idx" ON "core"."positions" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "row_history_row_idx" ON "core"."row_history" USING btree ("table_name","row_id","changed_at");--> statement-breakpoint
CREATE INDEX "row_history_changed_idx" ON "core"."row_history" USING btree ("changed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "web_presence_uq" ON "core"."web_presence" USING btree ("company_id","platform","url");--> statement-breakpoint
CREATE INDEX "web_presence_url_idx" ON "core"."web_presence" USING btree ("url");