import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { db } from "@fundhub/db/client";
import { posts, socialPosts } from "@fundhub/db/schema";
import { PostEditor, type PostFull, type SocialRow } from "@/components/content-views";
import { aiConfigured } from "@/lib/ai";
import { CAN, requireStaff } from "@/lib/auth";
import { websiteUrl } from "@/lib/site";

export const metadata: Metadata = { title: "Edit post" };

export default async function PostPage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff(CAN.content);
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const [post] = await db.select().from(posts).where(eq(posts.id, id));
  if (!post) notFound();
  const social = await db
    .select({ id: socialPosts.id, network: socialPosts.network, text: socialPosts.text, hashtags: socialPosts.hashtags, status: socialPosts.status })
    .from(socialPosts)
    .where(eq(socialPosts.postId, id));
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
