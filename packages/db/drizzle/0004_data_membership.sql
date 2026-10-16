-- Lets the website check a Data Intelligence membership without read access to billing tables.
CREATE OR REPLACE FUNCTION has_data_membership(uid integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM subscriptions s
    JOIN billing_customers c ON c.id = s.customer_id
    WHERE c.user_id = uid
      AND s.tier = 'data_member'
      AND s.status IN ('active', 'trialing', 'past_due')
  );
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION has_data_membership(integer) FROM PUBLIC;
--> statement-breakpoint
DO $$ BEGIN
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundhub_web') THEN
    GRANT EXECUTE ON FUNCTION has_data_membership(integer) TO fundhub_web;
  END IF;
  IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'fundhub_admin') THEN
    GRANT EXECUTE ON FUNCTION has_data_membership(integer) TO fundhub_admin;
  END IF;
END $$;
