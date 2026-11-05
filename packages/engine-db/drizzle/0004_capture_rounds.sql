CREATE TABLE "capture_round_items" (
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
	CONSTRAINT "capture_round_items_round_id_rcs_pk" PRIMARY KEY("round_id","rcs")
);
--> statement-breakpoint
CREATE TABLE "capture_rounds" (
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
ALTER TABLE "capture_round_items" ADD CONSTRAINT "capture_round_items_round_id_capture_rounds_id_fk" FOREIGN KEY ("round_id") REFERENCES "public"."capture_rounds"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "capture_round_items_next_idx" ON "capture_round_items" USING btree ("round_id","status","position");--> statement-breakpoint
CREATE UNIQUE INDEX "capture_rounds_one_active_uq" ON "capture_rounds" USING btree ("status") WHERE status = 'active';--> statement-breakpoint
CREATE TRIGGER capture_rounds_history AFTER INSERT OR UPDATE OR DELETE ON capture_rounds FOR EACH ROW EXECUTE FUNCTION engine_row_history();
