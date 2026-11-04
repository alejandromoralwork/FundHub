CREATE TABLE "row_history" (
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
ALTER TABLE "change_events" ADD COLUMN "actor" text;--> statement-breakpoint
CREATE INDEX "row_history_row_idx" ON "row_history" USING btree ("table_name","row_id","changed_at");--> statement-breakpoint
CREATE INDEX "row_history_changed_idx" ON "row_history" USING btree ("changed_at");--> statement-breakpoint
-- row_history: trigger function shared by the audited tables. Bookkeeping-only updates (timestamps that
-- move on every unchanged re-fetch) are skipped so the history only holds real changes.
CREATE OR REPLACE FUNCTION engine_row_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  o jsonb := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END;
  n jsonb := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END;
  noise text[] := ARRAY['last_seen_at', 'last_changed_at', 'classified_at', 'updated_at'];
BEGIN
  IF TG_OP = 'UPDATE' AND (o - noise) = (n - noise) THEN
    RETURN NEW;
  END IF;
  INSERT INTO row_history (table_name, row_id, op, old_row, new_row, actor)
  VALUES (
    TG_TABLE_NAME,
    coalesce(n ->> 'id', o ->> 'id', n ->> 'prefix', o ->> 'prefix'),
    TG_OP,
    o,
    n,
    nullif(current_setting('app.actor', true), '')
  );
  RETURN coalesce(NEW, OLD);
END;
$$;
--> statement-breakpoint
CREATE TRIGGER entities_history AFTER INSERT OR UPDATE OR DELETE ON entities FOR EACH ROW EXECUTE FUNCTION engine_row_history();
--> statement-breakpoint
CREATE TRIGGER entity_relations_history AFTER INSERT OR UPDATE OR DELETE ON entity_relations FOR EACH ROW EXECUTE FUNCTION engine_row_history();
--> statement-breakpoint
CREATE TRIGGER classification_rules_history AFTER INSERT OR UPDATE OR DELETE ON classification_rules FOR EACH ROW EXECUTE FUNCTION engine_row_history();
--> statement-breakpoint
CREATE TRIGGER activity_categories_history AFTER INSERT OR UPDATE OR DELETE ON activity_categories FOR EACH ROW EXECUTE FUNCTION engine_row_history();
--> statement-breakpoint
CREATE TRIGGER rcs_number_space_history AFTER INSERT OR UPDATE OR DELETE ON rcs_number_space FOR EACH ROW EXECUTE FUNCTION engine_row_history();
