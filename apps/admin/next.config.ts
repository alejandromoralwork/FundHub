/**
 * FILE: apps/admin/next.config.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: The settings file for the Console's Next.js app. It mounts the whole Console under /admin,
 *   tells Next.js to compile our shared packages, keeps the Postgres driver out of the bundle, raises the
 *   upload size limit for server actions, and adds security headers to every response.
 * WHERE IT RUNS: on the server / build machine (Node.js). Next.js reads it when building and starting the app;
 *   it never reaches the browser.
 * FRAMEWORK NOTES: Next.js looks for a file called next.config.ts in the app folder and uses its default
 *   export as configuration. `basePath: "/admin"` prefixes every page, API route and asset with /admin, so
 *   app/login/page.tsx is served at /admin/login, and `redirect("/login")` goes to /admin/login.
 * TYPESCRIPT YOU WILL SEE HERE: `import type`, a typed constant (`const x: NextConfig = …`), object literals,
 *   an `async` method inside an object, arrays of objects, `export default`.
 */

// `import type { NextConfig } from "next"`: only the TypeScript type describing valid settings
// ("next" = the Next.js library from npm). Using it lets TypeScript catch misspelt options.
import type { NextConfig } from "next";

/**
 * Kind: constant of type `NextConfig` — the configuration object.
 */
const nextConfig: NextConfig = {
  // Mounted at fundhub.lu/admin through the website's multi-zone rewrite.
  // ("Multi-zone": the public website forwards any /admin/… request to this separate app.)
  basePath: "/admin",
  // Our shared packages (`@fundhub/…` in packages/) are plain TypeScript source; this tells Next.js to
  // compile them along with the app.
  transpilePackages: ["@fundhub/core", "@fundhub/db", "@fundhub/email"],
  // "pg" (the Postgres driver from npm) is loaded by Node.js directly at run time instead of being bundled,
  // because it relies on Node features that do not survive bundling well.
  serverExternalPackages: ["pg"],
  // PDF report uploads go through a server action (Vercel's request limit is 4.5 MB).
  // Next.js's own default limit for server actions is lower (1 MB), so it is raised to match.
  experimental: { serverActions: { bodySizeLimit: "4.5mb" } },
  // Internal tool: never indexed, never framed.
  // `async headers()` is a method (a function inside the object) that returns, later, a list of rules.
  // Each rule says: for URLs matching `source`, add these HTTP headers to the response.
  async headers() {
    return [
      {
        // "/:path*" = every path in the app.
        source: "/:path*",
        headers: [
          // Ask search engines not to index pages or follow links.
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          // Forbid showing the Console inside a frame on another site (stops "clickjacking" tricks).
          { key: "X-Frame-Options", value: "DENY" },
          // Only send the "which page did you come from" information to our own site.
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};

// `export default` makes this object the file's main export, which is what Next.js reads.
export default nextConfig;
