/**
 * FILE: apps/web/src/app/robots.ts
 * PART: website (apps/web)
 * WHAT IT DOES: Produces the site's /robots.txt file, which tells search-engine crawlers (Google, Bing...)
 *   what they may visit: everything except /api/ (our internal data endpoints), and where the sitemap is.
 * WHERE IT RUNS: on the server (Node.js), when a crawler requests /robots.txt.
 * FRAMEWORK NOTES: robots.ts is a special Next.js App Router file name. Instead of writing robots.txt by hand,
 *   we export a function returning an object, and Next.js turns it into the text file at /robots.txt.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `import type`: import only a type.
 *   - return type annotation `(): MetadataRoute.Robots`: the function must return that shape of object.
 *   - template strings `` `${a}/b` ``: text with a value inserted at ${...}.
 */

// `import { a } from "b"` loads the named export `a` from module "b".
// MetadataRoute: Next.js's namespace of types for special files; `.Robots` describes robots.txt content.
import type { MetadataRoute } from "next";
// siteUrl(): our helper returning the site's base address (live domain on Vercel, localhost when developing).
import { siteUrl } from "@/lib/site";

/**
 * Kind: function (Next.js robots.txt generator). `export default` is what Next.js looks for in robots.ts.
 * Takes no parameters.
 * @returns `MetadataRoute.Robots`: the rules object. `userAgent: "*"` means "every crawler";
 *          `allow: "/"` lets them read the whole site; `disallow: "/api/"` keeps them out of the API.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: "/api/" },
    // Full address of the sitemap (made by sitemap.ts), e.g. "https://fundhub.lu/sitemap.xml".
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
