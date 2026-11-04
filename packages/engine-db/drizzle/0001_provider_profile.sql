CREATE TABLE "entity_relations" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"subject_entity_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"object_name" text NOT NULL,
	"object_normalized_name" text NOT NULL,
	"object_entity_id" uuid,
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
ALTER TABLE "entities" ADD COLUMN "website_verified_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "operating_countries" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "entities" ADD COLUMN "logo" jsonb;--> statement-breakpoint
ALTER TABLE "entity_relations" ADD CONSTRAINT "entity_relations_subject_entity_id_entities_id_fk" FOREIGN KEY ("subject_entity_id") REFERENCES "public"."entities"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_relations" ADD CONSTRAINT "entity_relations_object_entity_id_entities_id_fk" FOREIGN KEY ("object_entity_id") REFERENCES "public"."entities"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_relations" ADD CONSTRAINT "entity_relations_subcategory_id_activity_categories_id_fk" FOREIGN KEY ("subcategory_id") REFERENCES "public"."activity_categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "entity_relations" ADD CONSTRAINT "entity_relations_source_record_id_source_records_id_fk" FOREIGN KEY ("source_record_id") REFERENCES "public"."source_records"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "entity_relations_uq" ON "entity_relations" USING btree ("subject_entity_id","kind","object_normalized_name","source");--> statement-breakpoint
CREATE INDEX "entity_relations_object_idx" ON "entity_relations" USING btree ("object_entity_id");--> statement-breakpoint
CREATE INDEX "entity_relations_object_name_idx" ON "entity_relations" USING btree ("object_normalized_name");