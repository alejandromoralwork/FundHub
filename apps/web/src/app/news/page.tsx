import type { Metadata } from "next";
import Link from "next/link";
import { BookOpen } from "lucide-react";
import { Panel, SectionTitle } from "@/components/marketing";
import { PostGrid } from "@/components/post-grid";
import { listPublishedPosts } from "@fundhub/db/queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "News",
  description: "News about the Luxembourg fund services sector: regulation, market moves and FundHub announcements.",
};

export default async function NewsPage() {
  const items = await listPublishedPosts({ kind: "news" });
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 p-4 sm:p-6">
      <SectionTitle
        as="h1"
        eyebrow="News"
        title="Luxembourg fund services news"
        lead="What's changing in the sector: regulation, market moves, provider news and FundHub announcements. Written for buyers, never sponsored by providers."
      />
      <PostGrid items={items} empty="No news published yet." />
      <Panel className="flex flex-col gap-3 border-dashed sm:flex-row sm:items-center">
        <BookOpen className="h-8 w-8 shrink-0 text-emerald" />
        <div>
          <h2 className="text-sm font-semibold text-ink">Looking for practical guides?</h2>
          <p className="mt-0.5 text-sm text-ink-600">
            How to choose providers, read fee proposals and structure your service chain:{" "}
            <Link href="/learn" className="font-medium text-emerald-700 hover:underline">
              Learn
            </Link>
            .
          </p>
        </div>
      </Panel>
    </main>
  );
}
