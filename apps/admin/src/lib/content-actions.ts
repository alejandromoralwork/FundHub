"use server";

import { and, eq, ne } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { POST_KINDS, POST_STATUSES, SOCIAL_NETWORKS, SOCIAL_POST_STATUSES } from "@fundhub/core/enums";
import { slugify } from "@fundhub/core/format";
import { CATEGORY_SLUGS } from "@fundhub/core/taxonomy";
import { db } from "@fundhub/db/client";
import { getMarketStats } from "@fundhub/db/queries";
import { posts, providers, socialPosts } from "@fundhub/db/schema";
import { adaptForSocial, AiError, draftPost } from "./ai";
import { audit } from "./audit";
import { CAN, requireStaff } from "./auth";
import { websiteUrl } from "./site";

export type ActionResult = { ok?: string; error?: string; id?: number };

async function uniqueSlug(title: string, exceptId?: number): Promise<string> {
  const base = slugify(title).slice(0, 80) || "post";
  for (let i = 1; ; i++) {
    const slug = i === 1 ? base : `${base}-${i}`;
    const [clash] = await db
      .select({ id: posts.id })
      .from(posts)
      .where(and(eq(posts.slug, slug), exceptId ? ne(posts.id, exceptId) : undefined));
    if (!clash) return slug;
  }
}

const fail = (err: unknown): ActionResult => ({ error: err instanceof AiError || err instanceof Error ? err.message : "Something went wrong" });

export async function createPost(kind: string): Promise<ActionResult> {
  const staff = await requireStaff(CAN.content);
  const k = z.enum(POST_KINDS).parse(kind);
  const [row] = await db
    .insert(posts)
    .values({ kind: k, title: "Untitled draft", slug: await uniqueSlug(`draft-${Date.now()}`), authorId: staff.id })
    .returning({ id: posts.id });
  await audit(staff, "create", "posts", row.id);
  return { ok: "Draft created.", id: row.id };
}

/** Facts the AI may use, gathered from FundHub's own data. */
async function buildContext(opts: { useMarketStats: boolean; providerId?: number; notes: string }): Promise<string> {
  const parts: string[] = [];
  if (opts.notes.trim()) parts.push(`Editor's notes and sources:\n${opts.notes.trim()}`);
  if (opts.useMarketStats) {
    const s = await getMarketStats();
    parts.push(
      `FundHub market data (live index, public beta sample data):\n- ${s.providers} indexed providers, ${s.verified} verified\n` +
        s.byCategory.map((c) => `- ${c.category}: ${c.providers} providers, typical fee €${c.avgMin}-€${c.avgMax} per quarter`).join("\n") +
        `\n- Most used software: ${s.techStack.slice(0, 5).map((t) => `${t.label} (${Math.round(t.share * 100)}%)`).join(", ")}`,
    );
  }
  if (opts.providerId) {
    const [p] = await db.select().from(providers).where(eq(providers.id, opts.providerId));
    if (p) {
      parts.push(
        `Provider profile (${p.name}): category ${p.category}; ${p.providerType}; headcount ${p.headcount}; services: ${p.services.join(", ")}; licences: ${p.licences.join(", ") || "n/a"}; description: ${p.description}`,
      );
    }
  }
  return parts.join("\n\n");
}

const aiDraftSchema = z.object({
  kind: z.enum(POST_KINDS),
  brief: z.string().trim().min(15, "Describe what the article should cover (at least a sentence).").max(4000),
  notes: z.string().max(20_000).default(""),
  useMarketStats: z.boolean().default(false),
  providerId: z.number().int().positive().optional(),
});

/** Creates a new DRAFT from an AI brief. Nothing is published without review. */
export async function aiDraft(input: Record<string, unknown>): Promise<ActionResult> {
  const staff = await requireStaff(CAN.content);
  const parsed = aiDraftSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const d = parsed.data;
  try {
    const context = await buildContext({ useMarketStats: d.useMarketStats, providerId: d.providerId, notes: d.notes });
    const draft = await draftPost({ kind: d.kind, brief: d.brief, context });
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

export async function savePost(input: Record<string, unknown>): Promise<ActionResult> {
  const staff = await requireStaff(CAN.content);
  const parsed = postSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid post" };
  const { id, slug, ...values } = parsed.data;
  // Auto-named drafts ("draft-…") take their slug from the title; explicit slugs are kept.
  const nextSlug = await uniqueSlug(slug && !slug.startsWith("draft-") ? slug : values.title, id);
  await db.update(posts).set({ ...values, slug: nextSlug }).where(eq(posts.id, id));
  await audit(staff, "update", "posts", id, { title: values.title });
  revalidatePath(`/content/${id}`);
  return { ok: "Saved." };
}

export async function setPostStatus(id: number, status: string): Promise<ActionResult> {
  const staff = await requireStaff(CAN.content);
  const s = z.enum(POST_STATUSES).parse(status);
  const [post] = await db.select().from(posts).where(eq(posts.id, id));
  if (!post) return { error: "Post not found." };
  if (s === "published" && (post.title === "Untitled draft" || post.body.trim().length < 50)) {
    return { error: "Add a title and a body before publishing." };
  }
  if (s === "published" && /\[CHECK:/i.test(`${post.title} ${post.summary} ${post.body}`)) {
    return { error: "Resolve the [CHECK: …] notes left by the AI before publishing." };
  }
  await db
    .update(posts)
    .set({ status: s, publishedAt: s === "published" ? (post.publishedAt ?? new Date()) : post.publishedAt })
    .where(eq(posts.id, id));
  await audit(staff, s === "published" ? "publish" : "status", "posts", id, { status: s });
  revalidatePath(`/content/${id}`);
  revalidatePath("/content");
  return { ok: s === "published" ? `Published at ${websiteUrl()}/news/${post.slug}` : `Status: ${s}.` };
}

export async function deletePost(id: number): Promise<ActionResult> {
  const staff = await requireStaff(CAN.content);
  await db.delete(posts).where(eq(posts.id, id));
  await audit(staff, "delete", "posts", id);
  revalidatePath("/content");
  return { ok: "Post deleted." };
}

// ---------------------------------------------------------------- social

export async function generateSocial(postId: number): Promise<ActionResult> {
  const staff = await requireStaff(CAN.content);
  const [post] = await db.select().from(posts).where(eq(posts.id, postId));
  if (!post) return { error: "Post not found." };
  if (post.body.trim().length < 50) return { error: "Write the article first." };
  try {
    const drafts = await adaptForSocial({ title: post.title, summary: post.summary, body: post.body, url: `${websiteUrl()}/news/${post.slug}` });
    for (const network of SOCIAL_NETWORKS) {
      const values = { text: drafts[network].text, hashtags: drafts[network].hashtags, status: "draft" as const };
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

const socialSchema = z.object({
  id: z.number().int().positive(),
  text: z.string().max(5000),
  hashtags: z.array(z.string().trim().min(1).max(60)).max(30),
  status: z.enum(SOCIAL_POST_STATUSES),
});

export async function saveSocial(input: Record<string, unknown>): Promise<ActionResult> {
  const staff = await requireStaff(CAN.content);
  const parsed = socialSchema.safeParse(input);
  if (!parsed.success) return { error: "Invalid social post" };
  const { id, ...values } = parsed.data;
  const [row] = await db
    .update(socialPosts)
    .set({ ...values, hashtags: values.hashtags.map((h) => h.replace(/^#/, "")), publishedAt: values.status === "published" ? new Date() : null })
    .where(eq(socialPosts.id, id))
    .returning({ postId: socialPosts.postId });
  await audit(staff, "update", "social_posts", id, { status: values.status });
  if (row) revalidatePath(`/content/${row.postId}`);
  return { ok: "Saved." };
}

/** Columns used by the CSV export (for scheduling tools like Postiz, Buffer, Hootsuite). */
export async function socialCsv(postId: number): Promise<string> {
  await requireStaff(CAN.content);
  const rows = await db.select().from(socialPosts).where(eq(socialPosts.postId, postId));
  const esc = (v: string) => `"${v.replace(/"/g, '""')}"`;
  return [
    "network,text,hashtags,status",
    ...rows.map((r) => [r.network, esc(r.text), esc(r.hashtags.map((h) => `#${h}`).join(" ")), r.status].join(",")),
  ].join("\n");
}
