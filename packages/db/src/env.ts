/**
 * FILE: packages/db/src/env.ts
 * PART: shared package (packages/db)
 * WHAT IT DOES: Decides which database address ("connection string") to use, based on environment
 *   variables. A connection string looks like postgres://user:password@host:port/database and contains
 *   everything needed to log in to the database.
 * WHERE IT RUNS: on the server only (Node.js): the website, the console and the scripts all call it.
 * FRAMEWORK NOTES: Environment variables are settings given to a program from outside (the .env file
 *   locally, the project settings on Vercel). Node.js exposes them as `process.env.NAME`. Neon is the
 *   company hosting our production Postgres; its Vercel integration fills these variables automatically.
 * TYPESCRIPT YOU WILL SEE HERE: `export const`, `export function`, return type annotations `(): string`,
 *   `??` (nullish coalescing: take the first value that is not null/undefined), `throw new Error`.
 */

/** Local development default: the embedded Postgres started by `npm run db:local`. */
// Kind: constant (a fixed text). Matches the user, password and port set in scripts/local-postgres.ts.
export const LOCAL_DATABASE_URL = "postgres://postgres:postgres@localhost:5433/fundhub";

/**
 * Resolves the Postgres connection string. Neon's Vercel integration sets DATABASE_URL
 * (pooled, owner role) and POSTGRES_URL; FUNDHUB_DATABASE_URL overrides it per app.
 *
 * Kind: function. No parameters.
 * @returns `string`: the connection string to use for normal queries.
 * "Pooled" means the address goes through Neon's connection pooler, a middleman that shares a small number
 * of real database connections between many app instances. A "role" is a Postgres login with its own
 * permissions; the "owner" role may do anything to the tables, so each app is meant to use a weaker role.
 */
export function databaseUrl(): string {
  // FUNDHUB_DATABASE_URL carries the part's own least-privilege role (see scripts/roles.ts);
  // DATABASE_URL is the owner connection managed by the Neon integration.
  // `a ?? b ?? c` = first one that is set wins, in that order of preference.
  const url = process.env.FUNDHUB_DATABASE_URL ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (url) return url;
  // On Vercel (production/previews) a missing setting is a mistake: fail loudly instead of quietly trying
  // to reach a local database that does not exist there.
  if (process.env.VERCEL) {
    throw new Error("No database configured. Set DATABASE_URL (Neon) in the Vercel project.");
  }
  // On a developer's machine with nothing configured, use the local embedded Postgres.
  return LOCAL_DATABASE_URL;
}

/** Direct (non-pooled) URL for migrations, which need session-level features. */
/**
 * Kind: function.
 * @returns `string`: a connection string that talks to Postgres directly, not through the pooler.
 * Migrations change table structure and rely on things that last for a whole connection "session" (such as
 * locks and transactions spanning several statements); a pooler may swap connections between statements,
 * so migrations use the direct address. Falls back to databaseUrl() when no direct address is configured.
 */
export function migrationUrl(): string {
  return process.env.DATABASE_URL_UNPOOLED ?? process.env.POSTGRES_URL_NON_POOLING ?? databaseUrl();
}
