/**
 * FILE: apps/admin/src/app/(console)/content/[id]/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The "Edit post" page of the Content studio. It reads the post number from the URL, loads
 *   that article and its social-media versions from the database, and opens them in the post editor.
 *   If the number is invalid or no such post exists, it shows the "not found" page.
 * WHERE IT RUNS: on the server (Node.js), as a server component that reads the database; the PostEditor
 *   component it renders runs in the browser.
 * FRAMEWORK NOTES: a folder name in square brackets, like "[id]", is a "dynamic segment": it matches any
 *   value in that part of the URL, and Next.js passes the value to the page as `params.id`. So
 *   /admin/content/42 opens this page with id "42". ("(console)" is a route group, not in the URL.)
 * TYPESCRIPT YOU WILL SEE HERE: destructuring a parameter (`{ params }: {…}`), inline object types,
 *   `Promise<…>`, `Number(...)`, array destructuring `[post]`, `as` type assertions, `async`/`await`.
 */

// `import { a } from "b"` loads named exports from module "b".
// Type for the page metadata (browser-tab title).
import type { Metadata } from "next";
// `notFound()` is a Next.js function that stops rendering and shows the 404 "not found" page instead.
import { notFound } from "next/navigation";
// Drizzle ORM helper: `eq(a, b)` = "a = b" in SQL.
import { eq } from "drizzle-orm";
// `@fundhub/…` = our shared packages. Database connection and the two tables used.
import { db } from "@fundhub/db/client";
import { posts, socialPosts } from "@fundhub/db/schema";
// `@/…` = this app's src folder. The editor component and the types of its data.
import { PostEditor, type PostFull, type SocialRow } from "@/components/content-views";
// `aiConfigured()` says whether the AI writing assistant has its API key set.
import { aiConfigured } from "@/lib/ai";
// Role table and login/role check.
import { CAN, requireStaff } from "@/lib/auth";
// `websiteUrl()` = the public website's address, used for "view on site" links.
import { websiteUrl } from "@/lib/site";

/** Kind: constant. Browser-tab title, read by Next.js. */
export const metadata: Metadata = { title: "Edit post" };

/**
 * Kind: React component (async server component) — the page.
 * @param props  Next.js passes one object; `{ params }` destructures (unpacks) its `params` field.
 *               Its type `{ params: Promise<{ id: string }> }` says: params arrives later (a Promise) and
 *               holds `id`, the text from the [id] part of the URL.
 * @returns `Promise<JSX>`: the editor markup, arriving later because the function is `async`.
 */
export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  // Only roles in CAN.content (owner, operations, sales) may edit content.
  await requireStaff(CAN.content);
  // Wait for params, take `.id` (text such as "42") and convert it to a number with `Number(...)`.
  const id = Number((await params).id);
  // `Number.isInteger` is false for things like "abc" (which becomes NaN, "not a number"): show 404.
  if (!Number.isInteger(id)) notFound();
  // Fetch the post with this id. The query returns an array; `[post]` takes the first item, or undefined.
  const [post] = await db.select().from(posts).where(eq(posts.id, id));
  // `!post` = "post is missing": show 404.
  if (!post) notFound();
  // Load the social-media versions (LinkedIn etc.) written for this post.
  const social = await db
    .select({ id: socialPosts.id, network: socialPosts.network, text: socialPosts.text, hashtags: socialPosts.hashtags, status: socialPosts.status })
    .from(socialPosts)
    .where(eq(socialPosts.postId, id));
  // Render the editor.
  // - `key={post.id}` is a special React prop: when it changes, React throws the old editor away and builds a
  //   fresh one, so typed-in state from one post never leaks into another.
  // - post: the JSON round-trip turns Dates into strings for the browser; `as PostFull` labels the type.
  // - social is already plain data; `as SocialRow[]` just tells TypeScript its exact type.
  return (
    <PostEditor
      key={post.id}
      post={JSON.parse(JSON.stringify(post)) as PostFull}
      social={social as SocialRow[]}
      aiReady={aiConfigured()}
      websiteUrl={websiteUrl()}
    />
  );
}
