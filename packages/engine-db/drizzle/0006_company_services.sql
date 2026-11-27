CREATE TABLE "core"."company_services" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"company_id" uuid NOT NULL,
	"key" text NOT NULL,
	"category_id" integer,
	"label" text,
	"source" text NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"evidence" text,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "core"."company_services" ADD CONSTRAINT "company_services_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "core"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."company_services" ADD CONSTRAINT "company_services_category_id_activity_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "core"."activity_categories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_services_uq" ON "core"."company_services" USING btree ("company_id","key","source");--> statement-breakpoint
CREATE INDEX "company_services_category_idx" ON "core"."company_services" USING btree ("category_id") WHERE valid_to is null;