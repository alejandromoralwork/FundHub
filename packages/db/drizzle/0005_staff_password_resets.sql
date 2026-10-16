CREATE TABLE "staff_password_resets" (
	"id" text PRIMARY KEY NOT NULL,
	"staff_user_id" integer NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "staff_password_resets" ADD CONSTRAINT "staff_password_resets_staff_user_id_staff_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."staff_users"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
-- Admin-only table: the Console's role gets access now, so production works without re-running db:roles.
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundhub_admin') THEN
    GRANT ALL ON TABLE staff_password_resets TO fundhub_admin;
  END IF;
END $$;
