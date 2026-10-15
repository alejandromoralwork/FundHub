import type { Metadata } from "next";
import { count, desc, eq } from "drizzle-orm";
import { db } from "@fundhub/db/client";
import { posts, providers, socialPosts } from "@fundhub/db/schema";
import { ContentList, type PostRow } from "@/components/content-views";
import { aiConfigured } from "@/lib/ai";
import { CAN, requireStaff } from "@/lib/auth";
import { websiteUrl } from "@/lib/site";

export const metadata: Metadata = { title: "Content studio" };

export default async function ContentPage() {
  await requireStaff(CAN.content);
  const [rows, providerList] = await Promise.all([
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
        socialCount: count(socialPosts.id),
      })
      .from(posts)
      .leftJoin(socialPosts, eq(socialPosts.postId, posts.id))
      .groupBy(posts.id)
      .orderBy(desc(posts.updatedAt)),
    db.select({ id: providers.id, name: providers.name }).from(providers).where(eq(providers.status, "published")).orderBy(providers.name),
  ]);
  return <ContentList rows={JSON.parse(JSON.stringify(rows)) as PostRow[]} providers={providerList} aiReady={aiConfigured()} websiteUrl={websiteUrl()} />;
}
