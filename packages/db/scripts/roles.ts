/**
 * Creates one Postgres login role per FundHub part, so each can only touch what it needs.
 * Run once per database as the owner (e.g. Neon's default role):
 *
 *   DATABASE_URL=<owner url> WEB_DB_PASSWORD=… ADMIN_DB_PASSWORD=… SCRAPER_DB_PASSWORD=… ANALYST_DB_PASSWORD=… npm run db:roles
 *
 * Then give each app its own connection string (same host/database, different user).
 */
/**
 * FILE: packages/db/scripts/roles.ts
 * PART: shared package (packages/db)
 * WHAT IT DOES: Creates (or updates the password of) four database logins and sets what each may do:
 *   - fundhub_web: the public website; reads/writes public tables, cannot see staff, billing or ingest data.
 *   - fundhub_admin: the internal console; may do everything to every table.
 *   - fundhub_scraper: the scraper; reads providers and writes only the ingest_* tables.
 *   - fundhub_analyst_ro: read-only ("ro") access for the console's SQL screen.
 *   This is the "least privilege" principle: if one part is hacked, the attacker gets only that part's rights.
 * WHERE IT RUNS: from a developer's terminal (Node.js), connected as the database owner.
 * FRAMEWORK NOTES (Postgres): a "role" is a database user. GRANT gives a role a permission (select = read,
 *   insert = add rows, update = change rows, delete = remove rows, all = everything); REVOKE takes it away.
 *   A "schema" is a folder of tables inside a database ("public" is the default one); a role needs
 *   "usage" on the schema before it can reach any table in it. A "sequence" is the counter that produces
 *   auto-numbered ids; inserting a row needs permission to take the next number from it.
 *   Grants "on all tables" cover only tables that exist right now, hence the reminder to re-run.
 * TYPESCRIPT YOU WILL SEE HERE: arrays, spread `...ARRAY` (copy items into another array), tuple types
 *   `[string, string][]` (array of fixed pairs), arrow functions, regular expressions `/'/g`,
 *   `instanceof`, template strings.
 */

// `import { a } from "b"`: bring named items from another module.
// Loads .env into process.env.
import "dotenv/config";
// Postgres connection pool from the "pg" driver.
import { Pool } from "pg";
// Direct (non-pooled) owner connection string (see src/env.ts).
import { migrationUrl } from "../src/env";

// Kind: constant. Tables the scraper writes its results into before staff review them.
const INGEST_TABLES = ["ingest_runs", "ingest_jobs", "ingest_records"];
// Kind: constant. Tables only the console may touch: staff logins, audit trail, emails, money, and ingest.
// `...INGEST_TABLES` spreads (copies) the three ingest table names into this list.
const ADMIN_ONLY_TABLES = [
  "staff_users",
  "staff_sessions",
  "staff_password_resets",
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

/**
 * Kind: function.
 * Reads a required environment variable and makes it safe to place inside a SQL text in single quotes.
 * @param name  type `string` — the variable name, e.g. "WEB_DB_PASSWORD".
 * @returns `string`: the value with each ' doubled to '' (SQL's way of writing a quote inside a quoted text).
 *          `/'/g` is a regular expression meaning "every ' character" (g = global, all occurrences).
 */
function need(name: string) {
  // `process.env[name]` = look up the variable whose name is in `name`.
  const v = process.env[name];
  if (!v) throw new Error(`Set ${name}`);
  return v.replace(/'/g, "''");
}

/**
 * Kind: async function.
 * Creates the roles and applies all grants.
 * @returns `Promise<void>`.
 */
async function main() {
  const pool = new Pool({ connectionString: migrationUrl(), max: 1 });
  // A tiny helper: `q("…sql…")` runs one SQL statement. `(s: string) => …` is an arrow function with a
  // typed parameter.
  const q = (s: string) => pool.query(s);
  // Tuple type `[string, string][]` = an array of pairs: [role name, password].
  const roles: [string, string][] = [
    ["fundhub_web", need("WEB_DB_PASSWORD")],
    ["fundhub_admin", need("ADMIN_DB_PASSWORD")],
    ["fundhub_scraper", need("SCRAPER_DB_PASSWORD")],
    ["fundhub_analyst_ro", need("ANALYST_DB_PASSWORD")],
  ];
  // `[role, pw]` unpacks each pair.
  for (const [role, pw] of roles) {
    // `do $$ begin … end $$;` runs a small anonymous PL/pgSQL program (Postgres's built-in scripting
    // language) so we can use if/else: create the login if it does not exist (pg_roles lists all roles),
    // otherwise just set its password. This makes the script safe to run again.
    await q(`do $$ begin
      if not exists (select from pg_roles where rolname = '${role}') then create role ${role} login password '${pw}';
      else alter role ${role} with login password '${pw}'; end if; end $$;`);
    // Allow the role to enter the "public" schema (needed before any table grant has effect).
    await q(`grant usage on schema public to ${role}`);
  }

  // Admin: everything.
  await q(`grant all on all tables in schema public to fundhub_admin`);
  await q(`grant all on all sequences in schema public to fundhub_admin`);

  // Analyst: read-only everywhere (used by the admin SQL console).
  await q(`grant select on all tables in schema public to fundhub_analyst_ro`);

  // Web: read/write public-facing tables, no access to staff, billing or ingest tables.
  // Strategy: grant on everything first, then take rights away from the sensitive tables.
  await q(`grant select, insert, update, delete on all tables in schema public to fundhub_web`);
  await q(`grant usage, select on all sequences in schema public to fundhub_web`);
  // `.join(", ")` makes "staff_users, staff_sessions, …" for the SQL statement.
  await q(`revoke all on ${ADMIN_ONLY_TABLES.join(", ")} from fundhub_web`);
  await q(`revoke insert, update, delete on ${WEB_READ_ONLY_TABLES.join(", ")} from fundhub_web`);
  // Hide Drizzle's migration bookkeeping table. `.catch(() => {})` ignores the error if it is not found here.
  await q(`revoke all on __drizzle_migrations from fundhub_web`).catch(() => {});
  // Membership check without read access to billing (see migration 0004).
  // has_data_membership is a database function (defined in a migration) that answers "does this provider
  // have a paid data plan?" without letting the website read the billing tables themselves.
  // "execute" is the permission to call a function. Ignored if the function does not exist yet.
  await q(`grant execute on function has_data_membership(integer) to fundhub_web, fundhub_admin`).catch(() => {});

  // Scraper: read providers, write only ingest tables.
  await q(`grant select on providers to fundhub_scraper`);
  await q(`grant select, insert, update on ${INGEST_TABLES.join(", ")} to fundhub_scraper`);
  await q(`grant usage, select on all sequences in schema public to fundhub_scraper`);

  await pool.end();
  console.log("✔ Roles fundhub_web, fundhub_admin, fundhub_scraper, fundhub_analyst_ro configured");
  console.log("  Re-run after migrations that add tables, so grants cover them.");
}

// On failure print only the message (`err instanceof Error` checks it is a real Error object; the ternary
// falls back to printing whatever was thrown), then exit with code 1.
main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
