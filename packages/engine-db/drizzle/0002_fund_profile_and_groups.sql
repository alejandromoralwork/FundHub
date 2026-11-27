CREATE TABLE "core"."company_group_members" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"group_id" integer NOT NULL,
	"company_id" uuid NOT NULL,
	"role" text NOT NULL,
	"source" text NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"evidence" text,
	"valid_from" timestamp with time zone DEFAULT now() NOT NULL,
	"valid_to" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "core"."company_groups" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"layer" text NOT NULL,
	"kind" text NOT NULL,
	"parent_group_id" integer,
	"head_company_id" uuid,
	"head_lei" text,
	"head_country" text,
	"source" text NOT NULL,
	"confidence" real DEFAULT 1 NOT NULL,
	"description" text,
	"member_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "company_groups_key_unique" UNIQUE("key")
);
--> statement-breakpoint
ALTER TABLE "core"."companies" ADD COLUMN "fund_regime" text;--> statement-breakpoint
ALTER TABLE "core"."companies" ADD COLUMN "fund_law" text;--> statement-breakpoint
ALTER TABLE "core"."companies" ADD COLUMN "legal_vehicle" text;--> statement-breakpoint
ALTER TABLE "core"."companies" ADD COLUMN "fund_role" text;--> statement-breakpoint
ALTER TABLE "core"."companies" ADD COLUMN "manager_type" text;--> statement-breakpoint
ALTER TABLE "core"."company_group_members" ADD CONSTRAINT "company_group_members_group_id_company_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "core"."company_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."company_group_members" ADD CONSTRAINT "company_group_members_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "core"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."company_groups" ADD CONSTRAINT "company_groups_parent_group_id_company_groups_id_fk" FOREIGN KEY ("parent_group_id") REFERENCES "core"."company_groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "core"."company_groups" ADD CONSTRAINT "company_groups_head_company_id_companies_id_fk" FOREIGN KEY ("head_company_id") REFERENCES "core"."companies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "company_group_members_uq" ON "core"."company_group_members" USING btree ("group_id","company_id");--> statement-breakpoint
CREATE INDEX "company_group_members_company_idx" ON "core"."company_group_members" USING btree ("company_id");--> statement-breakpoint
CREATE INDEX "company_group_members_current_idx" ON "core"."company_group_members" USING btree ("group_id") WHERE valid_to is null;--> statement-breakpoint
CREATE INDEX "company_groups_parent_idx" ON "core"."company_groups" USING btree ("parent_group_id");--> statement-breakpoint
CREATE INDEX "company_groups_head_idx" ON "core"."company_groups" USING btree ("head_company_id");--> statement-breakpoint
CREATE INDEX "company_groups_layer_idx" ON "core"."company_groups" USING btree ("layer","kind");--> statement-breakpoint
CREATE INDEX "companies_fund_idx" ON "core"."companies" USING btree ("fund_regime","fund_law");--> statement-breakpoint
CREATE INDEX "companies_fund_role_idx" ON "core"."companies" USING btree ("fund_role");