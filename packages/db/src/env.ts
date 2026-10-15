/** Local development default: the embedded Postgres started by `npm run db:local`. */
export const LOCAL_DATABASE_URL = "postgres://postgres:postgres@localhost:5433/fundhub";

/**
 * Resolves the Postgres connection string. Neon's Vercel integration sets DATABASE_URL
 * (pooled, owner role) and POSTGRES_URL; FUNDHUB_DATABASE_URL overrides it per app.
 */
export function databaseUrl(): string {
  // FUNDHUB_DATABASE_URL carries the part's own least-privilege role (see scripts/roles.ts);
  // DATABASE_URL is the owner connection managed by the Neon integration.
  const url = process.env.FUNDHUB_DATABASE_URL ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  if (url) return url;
  if (process.env.VERCEL) {
    throw new Error("No database configured. Set DATABASE_URL (Neon) in the Vercel project.");
  }
  return LOCAL_DATABASE_URL;
}

/** Direct (non-pooled) URL for migrations, which need session-level features. */
export function migrationUrl(): string {
  return process.env.DATABASE_URL_UNPOOLED ?? process.env.POSTGRES_URL_NON_POOLING ?? databaseUrl();
}
