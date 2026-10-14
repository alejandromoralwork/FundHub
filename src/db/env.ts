/**
 * Resolves libSQL credentials from the environment.
 * Supports our own DATABASE_* names and the TURSO_* names set by the
 * Vercel Marketplace Turso integration. Falls back to a local file in dev.
 */
export function databaseCredentials(): { url: string; authToken?: string } {
  const url = process.env.DATABASE_URL ?? process.env.TURSO_DATABASE_URL;
  const authToken = process.env.DATABASE_AUTH_TOKEN ?? process.env.TURSO_AUTH_TOKEN;

  if (!url) {
    if (process.env.VERCEL) {
      throw new Error(
        "No database configured. Set DATABASE_URL (+ DATABASE_AUTH_TOKEN) or install the Turso integration on Vercel.",
      );
    }
    return { url: "file:./local.db" };
  }

  return authToken ? { url, authToken } : { url };
}
