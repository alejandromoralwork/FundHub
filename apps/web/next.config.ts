/**
 * FILE: apps/web/next.config.ts
 * PART: website (apps/web)
 * WHAT IT DOES: The settings file for the Next.js framework that runs the website. Next.js reads it when the
 *   site is built or started. Here it: compiles our shared packages, keeps the Postgres driver out of the
 *   bundle, forwards every /admin address to the separate internal console app, and permanently redirects a
 *   few old URLs to their new homes.
 * WHERE IT RUNS: on the server / build machine only (Node.js), never in the browser.
 * FRAMEWORK NOTES: Next.js looks for a file called exactly `next.config.ts` (or .js/.mjs) in the app folder.
 *   It must `export default` a configuration object.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `import type` = import only a type (a description), used for checking and removed from the final code.
 *   - `const x: NextConfig = {…}` = a type annotation: TypeScript checks every setting name and value.
 *   - `async` methods inside an object; `??` (use the right side if the left is null/undefined); ternary.
 *   - `export default` = the file's main export.
 */

// `NextConfig` = the type that lists every allowed Next.js setting. "next" is the Next.js npm package.
import type { NextConfig } from "next";

/** Kind: constant. The website's Next.js configuration object (exported below). */
const nextConfig: NextConfig = {
  // Shared workspace packages ship TypeScript source.
  // (Next.js normally expects libraries to be ready-made JavaScript, so it is told to compile these itself.)
  transpilePackages: ["@fundhub/core", "@fundhub/db", "@fundhub/email"],
  // "pg" (the Postgres database driver) is loaded from node_modules at run time instead of being bundled,
  // because it relies on Node.js features that bundling can break.
  serverExternalPackages: ["pg"],
  // Multi-zones: the internal admin platform is a separate app mounted at /admin.
  /**
   * Kind: async method. A "rewrite" quietly serves a URL from somewhere else; the address bar does not change.
   * @returns `Promise<array of { source, destination }>`: the rewrite rules, or an empty list.
   */
  async rewrites() {
    // Where the console app runs: the ADMIN_ORIGIN setting; otherwise, in development only, port 3001 on
    // this PC; otherwise `null` (no console available).
    const admin = process.env.ADMIN_ORIGIN ?? (process.env.NODE_ENV === "development" ? "http://localhost:3001" : null);
    if (!admin) return [];
    // `:path*` = "any further path segments", e.g. /admin/providers/12 → <console>/admin/providers/12.
    return [
      { source: "/admin", destination: `${admin}/admin` },
      { source: "/admin/:path*", destination: `${admin}/admin/:path*` },
    ];
  },
  /**
   * Kind: async method. A "redirect" tells the browser to go to a new address. `permanent: true` sends the
   * HTTP status 308 so search engines move old rankings to the new URL.
   * @returns `Promise<array of { source, destination, permanent }>`: the redirect rules.
   */
  async redirects() {
    return [
      { source: "/about", destination: "/methodology", permanent: true },
      { source: "/insights", destination: "/news", permanent: true },
      // `:slug` captures one path segment and reuses it in the destination.
      { source: "/insights/:slug", destination: "/news/:slug", permanent: true },
    ];
  },
};

// Hand the configuration to Next.js.
export default nextConfig;
