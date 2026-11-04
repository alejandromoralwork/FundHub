/**
 * FILE: apps/admin/src/app/(console)/content/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The "Content studio" list page. It loads every article (news and learn posts) with how many
 *   social-media versions each has, plus the list of published providers (for linking a post to a company),
 *   and shows them in the content list component.
 * WHERE IT RUNS: on the server (Node.js), as a server component reading the database; the ContentList
 *   component runs in the browser.
 * FRAMEWORK NOTES: page.tsx in app/(console)/content = the URL /admin/content ("(console)" is a route group,
 *   not in the URL; /admin is the Console's basePath).
 * TYPESCRIPT YOU WILL SEE HERE: `Promise.all` with array destructuring, multi-line object literals,
 *   `as` type assertions, `async`/`await`.
 */

// `import { a } from "b"` loads named exports from module "b".
// Type for the page metadata (browser-tab title).
import type { Metadata } from "next";
// Drizzle ORM helpers: `count` = SQL COUNT(), `desc` = sort descending, `eq` = "equals".
import { count, desc, eq } from "drizzle-orm";
// `@fundhub/…` = our shared packages. Database connection and the tables used.
import { db } from "@fundhub/db/client";
import { posts, providers, socialPosts } from "@fundhub/db/schema";
// `@/…` = this app's src folder. The list component and the type of one row.
import { ContentList, type PostRow } from "@/components/content-views";
// Whether the AI writing assistant is configured.
import { aiConfigured } from "@/lib/ai";
// Role table and login/role check.
import { CAN, requireStaff } from "@/lib/auth";
// The public website's address, for "view on site" links.
import { websiteUrl } from "@/lib/site";

/** Kind: constant. Browser-tab title, read by Next.js. */
export const metadata: Metadata = { title: "Content studio" };

/**
 * Kind: React component (async server component) — the page.
 * Parameters: none.
 * @returns `Promise<JSX>`: the content list markup, arriving later because the function is `async`.
 */
export default async function ContentPage() {
  // Only roles in CAN.content may use the Content studio.
  await requireStaff(CAN.content);
  // Run two queries at once (`Promise.all`) and name the results `rows` and `providerList`.
  const [rows, providerList] = await Promise.all([
    // 1) Every post with a count of its social versions.
    db
      .select({
        id: posts.id,
        title: posts.title,
        slug: posts.slug,
        kind: posts.kind,
        status: posts.status,
        topic: posts.topic,
        aiGenerated: posts.aiGenerated,
        publishedAt: posts.publishedAt,
        updatedAt: posts.updatedAt,
        // COUNT of matching social posts (0 when there are none, thanks to the left join).
        socialCount: count(socialPosts.id),
      })
      .from(posts)
      // Attach each post's social versions; "left" keeps posts that have none.
      .leftJoin(socialPosts, eq(socialPosts.postId, posts.id))
      // GROUP BY post, so we get one row per post and the COUNT is per post.
      .groupBy(posts.id)
      // Most recently edited first.
      .orderBy(desc(posts.updatedAt)),
    // 2) Published providers (id + name), alphabetical, for the "related provider" picker.
    db.select({ id: providers.id, name: providers.name }).from(providers).where(eq(providers.status, "published")).orderBy(providers.name),
  ]);
  // The JSON round-trip turns Dates into strings so the rows can be passed to the browser component;
  // `as PostRow[]` labels the result's type.
  return <ContentList rows={JSON.parse(JSON.stringify(rows)) as PostRow[]} providers={providerList} aiReady={aiConfigured()} websiteUrl={websiteUrl()} />;
}
