import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3 } from "lucide-react";
import { Panel, SectionTitle } from "@/components/marketing";
import { PostGrid } from "@/components/post-grid";
import { listPublishedPosts } from "@fundhub/db/queries";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Learn",
  description: "Independent guides on choosing Luxembourg fund service providers, reading fee proposals and structuring your fund.",
};

export default async function LearnPage() {
  const items = await listPublishedPosts({ kind: "learn" });
  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 p-4 sm:p-6">
      <SectionTitle
        as="h1"
        eyebrow="Learn"
        title="Guides for fund buyers"
        lead="Practical, independent guides: choosing providers, reading fee proposals, negotiating, and structuring your fund's service chain in Luxembourg."
      />
      <PostGrid items={items} empty="No guides published yet." />
      <Panel className="flex flex-col gap-3 border-dashed sm:flex-row sm:items-center">
        <BarChart3 className="h-8 w-8 shrink-0 text-emerald" />
        <div>
          <h2 className="text-sm font-semibold text-ink">Want the numbers behind the guides?</h2>
          <p className="mt-0.5 text-sm text-ink-600">
            Live statistics and quarterly reports are in{" "}
            <Link href="/data-intelligence" className="font-medium text-emerald-700 hover:underline">
              Data Intelligence
            </Link>
            .
          </p>
        </div>
      </Panel>
    </main>
  );
}
