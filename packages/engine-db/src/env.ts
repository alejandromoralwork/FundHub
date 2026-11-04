/**
 * FILE: packages/engine-db/src/env.ts
 * PART: shared package (packages/engine-db)
 * WHAT IT DOES: Decides which database address the Scraping Engine uses. The engine has its OWN database,
 *   separate from the website's (packages/db), so it reads its own variable ENGINE_DATABASE_URL and never
 *   falls back to the website's DATABASE_URL by accident.
 * WHERE IT RUNS: on Node.js only — engine workers, the engine CLI, migrations and the seed script.
 * FRAMEWORK NOTES: environment variables come from the .env file locally, or from the container/VM settings.
 * TYPESCRIPT YOU WILL SEE HERE: `export const`, `export function`, `??` (take the first value that is set).
 */

/** Kind: constant. Local default: the embedded Postgres started by `npm run engine:db:local` (port 5434). */
export const LOCAL_ENGINE_DATABASE_URL = "postgres://postgres:postgres@localhost:5434/fundhub_engine";

/**
 * Kind: function.
 * @returns `string`: the engine database connection string (ENGINE_DATABASE_URL, else the local default).
 */
export function engineDatabaseUrl(): string {
  return process.env.ENGINE_DATABASE_URL ?? LOCAL_ENGINE_DATABASE_URL;
}

/**
 * Kind: function.
 * @returns `string`: the direct (non-pooled) address for migrations and the job queue, which need
 *   session-level features (advisory locks, LISTEN). Falls back to engineDatabaseUrl().
 */
export function engineDirectUrl(): string {
  return process.env.ENGINE_DATABASE_URL_UNPOOLED ?? engineDatabaseUrl();
}
