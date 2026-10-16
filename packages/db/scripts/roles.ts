/**
 * Creates one Postgres login role per FundHub part, so each can only touch what it needs.
 * Run once per database as the owner (e.g. Neon's default role):
 *
 *   DATABASE_URL=<owner url> WEB_DB_PASSWORD=… ADMIN_DB_PASSWORD=… SCRAPER_DB_PASSWORD=… ANALYST_DB_PASSWORD=… npm run db:roles
 *
 * Then give each app its own connection string (same host/database, different user).
 */
import "dotenv/config";
import { Pool } from "pg";
import { migrationUrl } from "../src/env";

const INGEST_TABLES = ["ingest_runs", "ingest_jobs", "ingest_records"];
const ADMIN_ONLY_TABLES = [
  "staff_users",
  "staff_sessions",
  "audit_log",
  "email_messages",
  "billing_customers",
  "subscriptions",
  "invoices",
  "social_posts",
  "expenses",
  "budgets",
  ...INGEST_TABLES,
];
/** The website reads these but never writes them (content is managed in the admin). */
const WEB_READ_ONLY_TABLES = ["posts", "reports"];

function need(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Set ${name}`);
  return v.replace(/'/g, "''");
}

async function main() {
  const pool = new Pool({ connectionString: migrationUrl(), max: 1 });
  const q = (s: string) => pool.query(s);
  const roles: [string, string][] = [
    ["fundhub_web", need("WEB_DB_PASSWORD")],
    ["fundhub_admin", need("ADMIN_DB_PASSWORD")],
    ["fundhub_scraper", need("SCRAPER_DB_PASSWORD")],
    ["fundhub_analyst_ro", need("ANALYST_DB_PASSWORD")],
  ];
  for (const [role, pw] of roles) {
    await q(`do $$ begin
      if not exists (select from pg_roles where rolname = '${role}') then create role ${role} login password '${pw}';
      else alter role ${role} with login password '${pw}'; end if; end $$;`);
    await q(`grant usage on schema public to ${role}`);
  }

  // Admin: everything.
  await q(`grant all on all tables in schema public to fundhub_admin`);
  await q(`grant all on all sequences in schema public to fundhub_admin`);

  // Analyst: read-only everywhere (used by the admin SQL console).
  await q(`grant select on all tables in schema public to fundhub_analyst_ro`);

  // Web: read/write public-facing tables, no access to staff, billing or ingest tables.
  await q(`grant select, insert, update, delete on all tables in schema public to fundhub_web`);
  await q(`grant usage, select on all sequences in schema public to fundhub_web`);
  await q(`revoke all on ${ADMIN_ONLY_TABLES.join(", ")} from fundhub_web`);
  await q(`revoke insert, update, delete on ${WEB_READ_ONLY_TABLES.join(", ")} from fundhub_web`);
  await q(`revoke all on __drizzle_migrations from fundhub_web`).catch(() => {});
  // Membership check without read access to billing (see migration 0004).
  await q(`grant execute on function has_data_membership(integer) to fundhub_web, fundhub_admin`).catch(() => {});

  // Scraper: read providers, write only ingest tables.
  await q(`grant select on providers to fundhub_scraper`);
  await q(`grant select, insert, update on ${INGEST_TABLES.join(", ")} to fundhub_scraper`);
  await q(`grant usage, select on all sequences in schema public to fundhub_scraper`);

  await pool.end();
  console.log("✔ Roles fundhub_web, fundhub_admin, fundhub_scraper, fundhub_analyst_ro configured");
  console.log("  Re-run after migrations that add tables, so grants cover them.");
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
