CREATE TABLE "engine_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb,
	"updated_by" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TRIGGER engine_settings_history AFTER INSERT OR UPDATE OR DELETE ON engine_settings FOR EACH ROW EXECUTE FUNCTION engine_row_history();
--> statement-breakpoint
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
  VALUES (TG_TABLE_NAME, coalesce(n ->> 'id', o ->> 'id', n ->> 'prefix', o ->> 'prefix', n ->> 'key', o ->> 'key'), TG_OP, o, n, nullif(current_setting('app.actor', true), ''));
  RETURN coalesce(NEW, OLD);
END;
$$;
