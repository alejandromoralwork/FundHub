CREATE TABLE "lbr_search_words" (
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
CREATE INDEX "lbr_search_words_next_idx" ON "lbr_search_words" USING btree ("status","phase","seen");