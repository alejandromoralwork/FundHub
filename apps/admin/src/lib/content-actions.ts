"use server";

/**
 * FILE: apps/admin/src/lib/content-actions.ts
 * PART: console (apps/admin)
 * WHAT IT DOES: The server actions behind the Content Studio: create, edit, publish and delete articles
 *   ("news" and "learn" posts), ask the AI (Claude, via ./ai.ts) for a first draft based on an editor's brief
 *   and FundHub's own data, generate social-media versions of an article, edit those, and export them as CSV
 *   for social scheduling tools.
 * WHERE IT RUNS: only on the server (Node.js): database writes and AI calls with a secret key.
 * FRAMEWORK NOTES: `"use server";` (must stay the first line) turns every exported function into a Next.js
 *   "server action" that the Console's pages can call from the browser, while the code runs on the server.
 *   Each one starts with `requireStaff(CAN.content)` so only staff with content rights can use it.
 *   `revalidatePath(path)` tells Next.js to rebuild that page's cached version so changes show up.
 *   Zod (`z`) validates incoming data before it touches the database.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - type aliases with optional fields, `unknown`, `instanceof`, `as const`.
 *   - async/await, `try/catch`, `for` loops (including an endless `for (;;)`-style loop), ternaries.
 *   - object rest destructuring `const { id, ...values } = obj`, spread `{ ...values }`.
 *   - array methods `.map/.join/.slice`, template strings, regular expressions.
 *   - Zod: `z.object`, `z.enum`, `.parse` (throws) vs `.safeParse` (returns a result), `.default`, `.nullable`.
 *   - Drizzle: `.returning(...)`, `.onConflictDoUpdate(...)` (an "upsert").
 */

// `import { a } from "b"` brings named things from module b into this file.
// Drizzle ORM SQL helpers: `and` (A AND B), `eq` (=), `ne` (<>, not equal).
import { and, eq, ne } from "drizzle-orm";
// Next.js: mark a page's cache as stale.
import { revalidatePath } from "next/cache";
// Zod: input validation (npm library).
import { z } from "zod";
// `@fundhub/…` = our shared packages. Allowed post kinds/statuses, social networks and social post statuses.
import { POST_KINDS, POST_STATUSES, SOCIAL_NETWORKS, SOCIAL_POST_STATUSES } from "@fundhub/core/enums";
// Turns a title into a URL-friendly "slug": "Fees in 2026!" → "fees-in-2026".
import { slugify } from "@fundhub/core/format";
// The valid service-category slugs.
import { CATEGORY_SLUGS } from "@fundhub/core/taxonomy";
// The database connection.
import { db } from "@fundhub/db/client";
// A ready-made query returning FundHub's market statistics (provider counts, typical fees, software use).
import { getMarketStats } from "@fundhub/db/queries";
// Table definitions used here.
import { posts, providers, socialPosts } from "@fundhub/db/schema";
// `./…` = this folder. AI helpers and their error type.
import { adaptForSocial, AiError, draftPost } from "./ai";
// Audit log writer.
import { audit } from "./audit";
// Permission table and the "must be signed-in staff with this role" check.
import { CAN, requireStaff } from "./auth";
// The public website's base address (for article links).
import { websiteUrl } from "./site";

/**
 * Kind: type alias (exported).
 * Returned to the page: a success message, an error message, and/or the id of a created post (all optional).
 */
export type ActionResult = { ok?: string; error?: string; id?: number };

/**
 * Kind: async function (private).
 * Finds a slug for a post that no other post uses yet: "my-title", else "my-title-2", "my-title-3", …
 * @param title     type `string` — the text to make the slug from.
 * @param exceptId  optional, type `number` — the post being edited, which may keep its own slug.
 * @returns `Promise<string>`: a free slug.
 * Why: the slug is the article's URL, so two posts must never share one.
 */
async function uniqueSlug(title: string, exceptId?: number): Promise<string> {
  // At most 80 characters; if slugify produced nothing (e.g. a title of only symbols), use "post".
  const base = slugify(title).slice(0, 80) || "post";
  // `for (let i = 1; ; i++)` has no stop condition: it keeps counting until the `return` inside ends it.
  // `let` is used because i changes on every round.
  for (let i = 1; ; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    // Is there another post with this slug? When `exceptId` is given we ignore that post itself;
    // `undefined` inside `and(…)` is simply skipped by Drizzle.
    const [clash] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.slug, slug), exceptId ? ne(posts.id, exceptId) : undefined));
    if (!clash) return slug;
  }
}

/**
 * Kind: constant holding an arrow function.
 * Converts a caught error into an ActionResult the page can display.
 * @param err  type `unknown` — anything that was thrown (JavaScript lets you throw any value).
 * @returns `ActionResult` with the error's message, or a generic text if it is not a real Error.
 * `instanceof` checks which class a value was made from. (Every AiError is also an Error, so the first test
 * is just for clarity.)
 */
const fail = (err: unknown): ActionResult => ({ error: err instanceof AiError || err instanceof Error ? err.message : "Something went wrong" });

/**
 * Kind: server action.
 * Creates an empty draft post and returns its id so the editor can open it.
 * @param kind  type `string` — "news" or "learn" (checked below).
 * @returns `Promise<ActionResult>` with `id`.
 */
export async function createPost(kind: string): Promise<ActionResult> {
  const staff = await requireStaff(CAN.content);
  // `.parse` validates and returns the value, or THROWS if it is not an allowed kind.
  const k = z.enum(POST_KINDS).parse(kind);
  // Insert the draft. Its temporary slug is "draft-<current time in ms>", replaced once a title is saved
  // (see savePost). `.returning({ id })` makes Postgres send back the new row's id.
  const [row] = await db
    .insert(posts)
    .values({ kind: k, title: "Untitled draft", slug: await uniqueSlug(`draft-${Date.now()}`), authorId: staff.id })
    .returning({ id: posts.id });
  await audit(staff, "create", "posts", row.id);
  return { ok: "Draft created.", id: row.id };
}

/**
 * Kind: async function (private).
 * Facts the AI may use, gathered from FundHub's own data.
 * @param opts  an object: `useMarketStats` (`boolean`, include live market figures), `providerId` (optional
 *              `number`, include one provider's profile) and `notes` (`string`, the editor's own notes/sources).
 * @returns `Promise<string>`: one text block made of the chosen sections, separated by blank lines.
 * Why: the AI is told to rely ONLY on this context, so what goes in here limits what it can claim.
 */
async function buildContext(opts: { useMarketStats: boolean; providerId?: number; notes: string }): Promise<string> {
  // A list of text sections, joined at the end.
  const parts: string[] = [];
  // Editor's notes, if any (after trimming spaces).
  if (opts.notes.trim()) parts.push(`Editor's notes and sources:\n${opts.notes.trim()}`);
  if (opts.useMarketStats) {
    const s = await getMarketStats();
    // Builds lines such as "- depositary: 12 providers, typical fee €2000-€5000 per quarter" with `.map`,
    // and the top 5 software tools with their share as a percentage. `+` joins strings together.
    parts.push(
      `FundHub market data (live index, public beta sample data):\n- ${s.providers} indexed providers, ${s.verified} verified\n` +
        s.byCategory.map((c) => `- ${c.category}: ${c.providers} providers, typical fee €${c.avgMin}-€${c.avgMax} per quarter`).join("\n") +
        `\n- Most used software: ${s.techStack.slice(0, 5).map((t) => `${t.label} (${Math.round(t.share * 100)}%)`).join(", ")}`,
    );
  }
  if (opts.providerId) {
    // The chosen provider's profile as one line of facts. `|| "n/a"` when it lists no licences.
    const [p] = await db.select().from(providers).where(eq(providers.id, opts.providerId));
    if (p) {
      parts.push(
        `Provider profile (${p.name}): category ${p.category}; ${p.providerType}; headcount ${p.headcount}; services: ${p.services.join(", ")}; licences: ${p.licences.join(", ") || "n/a"}; description: ${p.description}`,
      );
    }
  }
  return parts.join("\n\n");
}

/**
 * Kind: constant (Zod schema).
 * Input for an AI draft: kind, a brief of 15–4000 characters, optional notes (default ""), whether to add
 * market statistics (default false) and an optional provider id.
 */
const aiDraftSchema = z.object({
  kind: z.enum(POST_KINDS),
  brief: z.string().trim().min(15, "Describe what the article should cover (at least a sentence).").max(4000),
  notes: z.string().max(20_000).default(""),
  useMarketStats: z.boolean().default(false),
  providerId: z.number().int().positive().optional(),
});

/**
 * Kind: server action.
 * Creates a new DRAFT from an AI brief. Nothing is published without review.
 * @param input  type `Record<string, unknown>` — see aiDraftSchema.
 * @returns `Promise<ActionResult>` with the new post's `id`.
 */
export async function aiDraft(input: Record<string, unknown>): Promise<ActionResult> {
  const staff = await requireStaff(CAN.content);
  // `.safeParse` returns `{ success, data | error }` instead of throwing.
  const parsed = aiDraftSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const d = parsed.data;
  // `try { … } catch (err) { … }`: if anything inside throws (AI refusal, network error…), jump to `catch`
  // and turn it into a friendly error instead of crashing the page.
  try {
    const context = await buildContext({ useMarketStats: d.useMarketStats, providerId: d.providerId, notes: d.notes });
    const draft = await draftPost({ kind: d.kind, brief: d.brief, context });
    // Save the AI's draft as a new post. `aiGenerated: true` and the stored brief make it clear later that a
    // machine wrote the first version and what it was asked.
    const [row] = await db
      .insert(posts)
      .values({
        kind: d.kind,
        slug: await uniqueSlug(draft.title),
        title: draft.title,
        summary: draft.summary,
        body: draft.body,
        topic: draft.topic,
        category: draft.category,
        readMinutes: draft.readMinutes,
        aiGenerated: true,
        aiBrief: d.brief,
        authorId: staff.id,
      })
      .returning({ id: posts.id });
    await audit(staff, "ai-draft", "posts", row.id, { brief: d.brief });
    revalidatePath("/content");
    return { ok: "AI draft ready. Review every fact, then publish.", id: row.id };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Kind: constant (Zod schema).
 * Everything the post editor can save. `.nullable()` on category = a valid slug or null; `slug` is optional.
 */
const postSchema = z.object({
  id: z.number().int().positive(),
  title: z.string().trim().min(3).max(160),
  summary: z.string().trim().max(600),
  body: z.string().max(100_000),
  kind: z.enum(POST_KINDS),
  topic: z.string().trim().min(2).max(60),
  category: z.enum(CATEGORY_SLUGS).nullable(),
  readMinutes: z.number().int().min(1).max(60),
  slug: z.string().trim().max(100).optional(),
});

/**
 * Kind: server action.
 * Saves edits to a post.
 * @param input  type `Record<string, unknown>` — see postSchema.
 * @returns `Promise<ActionResult>`.
 */
export async function savePost(input: Record<string, unknown>): Promise<ActionResult> {
  const staff = await requireStaff(CAN.content);
  const parsed = postSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid post" };
  // Rest destructuring: take out `id` and `slug`; everything else goes into `values`.
  const { id, slug, ...values } = parsed.data;
  // Auto-named drafts ("draft-…") take their slug from the title; explicit slugs are kept.
  // Passing `id` lets this post keep its current slug without counting as a clash.
  const nextSlug = await uniqueSlug(slug && !slug.startsWith("draft-") ? slug : values.title, id);
  // UPDATE posts SET (all edited fields + slug) WHERE id = …
  await db.update(posts).set({ ...values, slug: nextSlug }).where(eq(posts.id, id));
  await audit(staff, "update", "posts", id, { title: values.title });
  revalidatePath(`/content/${id}`);
  return { ok: "Saved." };
}

/**
 * Kind: server action.
 * Changes a post's status (e.g. draft → published). Publishing has safety checks.
 * @param id      type `number` — the post id.
 * @param status  type `string` — the new status (must be one of POST_STATUSES).
 * @returns `Promise<ActionResult>`.
 */
export async function setPostStatus(id: number, status: string): Promise<ActionResult> {
  const staff = await requireStaff(CAN.content);
  const s = z.enum(POST_STATUSES).parse(status);
  const [post] = await db.select().from(posts).where(eq(posts.id, id));
  if (!post) return { error: "Post not found." };
  // Rule: no publishing of an untitled or almost empty post.
  if (s === "published" && (post.title === "Untitled draft" || post.body.trim().length < 50)) {
    return { error: "Add a title and a body before publishing." };
  }
  // Rule: the AI marks facts it could not confirm as "[CHECK: …]". A regular expression (`i` = ignore case)
  // searches title, summary and body; any leftover note blocks publishing until an editor resolves it.
  if (s === "published" && /\[CHECK:/i.test(`${post.title} ${post.summary} ${post.body}`)) {
    return { error: "Resolve the [CHECK: …] notes left by the AI before publishing." };
  }
  // Save the status. When publishing, keep the original publish date if it was published before
  // (`post.publishedAt ?? new Date()`), so re-publishing does not change the article's date.
  await db
    .update(posts)
    .set({ status: s, publishedAt: s === "published" ? (post.publishedAt ?? new Date()) : post.publishedAt })
    .where(eq(posts.id, id));
  await audit(staff, s === "published" ? "publish" : "status", "posts", id, { status: s });
  // Refresh both the editor page and the list.
  revalidatePath(`/content/${id}`);
  revalidatePath("/content");
  return { ok: s === "published" ? `Published at ${websiteUrl()}/news/${post.slug}` : `Status: ${s}.` };
}

/**
 * Kind: server action.
 * Permanently deletes a post.
 * @param id  type `number` — the post id.
 * @returns `Promise<ActionResult>`.
 */
export async function deletePost(id: number): Promise<ActionResult> {
  const staff = await requireStaff(CAN.content);
  await db.delete(posts).where(eq(posts.id, id));
  // The audit row survives, so there is a record that this post existed and who removed it.
  await audit(staff, "delete", "posts", id);
  revalidatePath("/content");
  return { ok: "Post deleted." };
}

// ---------------------------------------------------------------- social

/**
 * Kind: server action.
 * Asks the AI for LinkedIn/X/Facebook/Instagram versions of a post and saves them as drafts.
 * @param postId  type `number` — the article to adapt.
 * @returns `Promise<ActionResult>`.
 */
export async function generateSocial(postId: number): Promise<ActionResult> {
  const staff = await requireStaff(CAN.content);
  const [post] = await db.select().from(posts).where(eq(posts.id, postId));
  if (!post) return { error: "Post not found." };
  if (post.body.trim().length < 50) return { error: "Write the article first." };
  try {
    const drafts = await adaptForSocial({ title: post.title, summary: post.summary, body: post.body, url: `${websiteUrl()}/news/${post.slug}` });
    // One row per network.
    for (const network of SOCIAL_NETWORKS) {
      // `"draft" as const` keeps the exact value "draft" as its type (not just "some string"), which the
      // status column's type requires.
      const values = { text: drafts[network].text, hashtags: drafts[network].hashtags, status: "draft" as const };
      // "Upsert": insert a new row; if one already exists for this post + network (the unique `target`),
      // update it with the new values instead. So re-generating replaces the old drafts.
      await db
        .insert(socialPosts)
        .values({ postId, network, ...values })
        .onConflictDoUpdate({ target: [socialPosts.postId, socialPosts.network], set: values });
    }
    await audit(staff, "ai-social", "posts", postId);
    revalidatePath(`/content/${postId}`);
    return { ok: "Social versions generated for LinkedIn, X, Facebook and Instagram." };
  } catch (err) {
    return fail(err);
  }
}

/**
 * Kind: constant (Zod schema).
 * An edited social post: id, text (max 5000 chars), up to 30 hashtags (each 1–60 chars), and a valid status.
 */
const socialSchema = z.object({
  id: z.number().int().positive(),
  text: z.string().max(5000),
  hashtags: z.array(z.string().trim().min(1).max(60)).max(30),
  status: z.enum(SOCIAL_POST_STATUSES),
});

/**
 * Kind: server action.
 * Saves edits to one social post.
 * @param input  type `Record<string, unknown>` — see socialSchema.
 * @returns `Promise<ActionResult>`.
 */
export async function saveSocial(input: Record<string, unknown>): Promise<ActionResult> {
  const staff = await requireStaff(CAN.content);
  const parsed = socialSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid social post" };
  const { id, ...values } = parsed.data;
  // Strip any leading "#" from hashtags (they are stored without it). Marking it "published" records the
  // time; any other status clears the date. `.returning` gives back the article id, for refreshing its page.
  const [row] = await db
    .update(socialPosts)
    .set({ ...values, hashtags: values.hashtags.map((h) => h.replace(/^#/, "")), publishedAt: values.status === "published" ? new Date() : null })
    .where(eq(socialPosts.id, id))
    .returning({ postId: socialPosts.postId });
  await audit(staff, "update", "social_posts", id, { status: values.status });
  if (row) revalidatePath(`/content/${row.postId}`);
  return { ok: "Saved." };
}

/**
 * Kind: server action.
 * Columns used by the CSV export (for scheduling tools like Postiz, Buffer, Hootsuite).
 * @param postId  type `number` — the article whose social posts to export.
 * @returns `Promise<string>`: the CSV file content (one header line, then one line per network).
 */
export async function socialCsv(postId: number): Promise<string> {
  await requireStaff(CAN.content);
  const rows = await db.select().from(socialPosts).where(eq(socialPosts.postId, postId));
  // CSV escaping: wrap the value in double quotes and double any quote inside it ("" means a literal ").
  // This keeps commas and line breaks in the text from breaking the columns.
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  // Header line, then (`...` spreads the mapped lines into the outer array) one line per row with the
  // hashtags written as "#a #b"; finally all lines are joined with line breaks.
  return [
    "network,text,hashtags,status",
    ...rows.map((r) => [r.network, esc(r.text), esc(r.hashtags.map((h) => `#${h}`).join(" ")), r.status].join(",")),
  ].join("\n");
}
