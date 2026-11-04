/**
 * FILE: apps/web/src/app/sitemap.ts
 * PART: website (apps/web)
 * WHAT IT DOES: Produces /sitemap.xml, the list of every public page that search engines should index:
 *   fixed pages (home, compare, advisory...), one page per service category, every published article and
 *   every published provider profile.
 * WHERE IT RUNS: on the server (Node.js), when /sitemap.xml is requested. It reads the database.
 * FRAMEWORK NOTES: sitemap.ts is a special Next.js App Router file name. We export a function that returns an
 *   array of `{ url, lastModified? }` objects and Next.js writes the XML file for us.
 *   `dynamic = "force-dynamic"` makes it rebuild on every request so new providers/articles are included.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `Promise<MetadataRoute.Sitemap>`: the function is async and its result (a sitemap list) arrives later.
 *   - arrays `[...]`, arrow functions `(p) => ...`, `.map` (turn each item into a new item).
 *   - spread `...array`: unpack an array's items into a bigger array.
 *   - array destructuring `const [a, b] = ...`: name the first two items of an array.
 *   - nullish coalescing `a ?? b`: use `a`, unless it is null/undefined, then use `b`.
 */

// `import { a } from "b"` loads named exports. "next" is an npm library; "@fundhub/..." are our shared
// packages in packages/; "@/..." is this app's src folder.
// MetadataRoute.Sitemap: the Next.js type for the list this file returns.
import type { MetadataRoute } from "next";
// Database queries: listProviderOptions (published providers' id/slug/name) and listPublishedPosts (articles).
import { listProviderOptions, listPublishedPosts } from "@fundhub/db/queries";
// articleHref(kind, slug): builds an article's URL path, e.g. "/learn/my-guide" or "/news/my-story".
import { articleHref } from "@/lib/articles";
// siteUrl(): the site's base address (live domain or localhost).
import { siteUrl } from "@/lib/site";
// TAXONOMY: the shared list of service categories (administration, depositary...), each with a URL slug.
import { TAXONOMY } from "@fundhub/core/taxonomy";

/** Kind: constant (Next.js setting). Rebuild on every request instead of once at build time. */
export const dynamic = "force-dynamic";

/**
 * Kind: async function (Next.js sitemap generator). Takes no parameters.
 * @returns `Promise<MetadataRoute.Sitemap>`: an array of entries, each with a full `url` and optionally
 *          `lastModified` (the date it last changed, which helps crawlers decide what to re-read).
 */
export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  // `const` declares a name whose value is never reassigned.
  const base = siteUrl();
  // The fixed pages of the site, as paths. "" is the home page.
  const staticPaths = [
    "",
    "/compare",
    "/services",
    "/benchmarks",
    "/advisory",
    "/rfi",
    "/news",
    "/learn",
    "/fundhub-score",
    "/advisory/fund-setup",
    "/data-intelligence/membership",
    "/data-intelligence",
    "/awards",
    "/methodology",
    "/independence",
    "/for-providers",
  ];
  // `Promise.all([...])` runs both database queries at the same time and waits for both.
  // `.catch(() => [])` means: if a query fails (e.g. database down), use an empty list instead of crashing,
  // so the sitemap still lists the fixed pages. `const [providers, posts]` names the two results in order.
  const [providers, posts] = await Promise.all([listProviderOptions().catch(() => []), listPublishedPosts().catch(() => [])]);

  // Build one combined array. Each `...x.map(...)` turns a list into sitemap entries and unpacks them here.
  // `(p) => ({ ... })` is an arrow function returning an object; the extra round brackets are needed so the
  // curly braces are read as an object rather than a function body.
  return [
    // Fixed pages: base address + path.
    ...staticPaths.map((p) => ({ url: `${base}${p}` })),
    // One page per service category, e.g. /services/fund-administration.
    ...TAXONOMY.map((c) => ({ url: `${base}/services/${c.slug}` })),
    // Articles, with their publish date; `?? undefined` turns a missing (null) date into "no value".
    ...posts.map((p) => ({ url: `${base}${articleHref(p.kind, p.slug)}`, lastModified: p.publishedAt ?? undefined })),
    // Every published provider profile.
    ...providers.map((p) => ({ url: `${base}/providers/${p.slug}` })),
  ];
}
