import type { Metadata } from "next";
import Link from "next/link";
import { notFound, permanentRedirect } from "next/navigation";
import { ArrowLeft, Clock } from "lucide-react";
import Markdown from "react-markdown";
import { getCategory } from "@fundhub/core/taxonomy";
import { getPublishedPost } from "@fundhub/db/queries";
import { CtaBand } from "@/components/marketing";
import { articleHref } from "@/lib/articles";

type Props = { params: Promise<{ slug: string }> };
export type PostKind = "news" | "learn";

export async function articleMetadata({ params }: Props): Promise<Metadata> {
  const p = await getPublishedPost((await params).slug);
  return p ? { title: p.title, description: p.summary, openGraph: { title: p.title, description: p.summary, type: "article" } } : { title: "Article not found" };
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

/** Article page for one section; an article opened under the other section redirects to its own URL. */
export async function ArticlePage({ params, kind }: Props & { kind: PostKind }) {
  const article = await getPublishedPost((await params).slug);
  if (!article) notFound();
  if (article.kind !== kind) permanentRedirect(articleHref(article.kind, article.slug));
  const category = article.category ? getCategory(article.category) : undefined;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 p-4 sm:p-6">
      <Link href={`/${kind}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-600 hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> {kind === "news" ? "News" : "Learn"}
      </Link>

      <article className="rounded-lg border border-slate-200 bg-white p-6 sm:p-8">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-700">
          {article.kind === "news" ? "News" : "Learn"} · {article.topic}
        </p>
        <h1 className="mt-1 text-2xl font-semibold leading-snug text-ink">{article.title}</h1>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
          {article.publishedAt && dateFmt.format(article.publishedAt)} · <Clock className="h-3 w-3" /> {article.readMinutes} min read
        </p>
        <p className="mt-5 text-base leading-relaxed text-ink-600">{article.summary}</p>

        {/* Markdown without raw HTML: safe for staff- and AI-written content. */}
        <div className="prose-fh mt-6">
          <Markdown
            components={{
              h2: (p) => <h2 className="mt-6 mb-2 text-lg font-semibold text-ink" {...p} />,
              h3: (p) => <h3 className="mt-5 mb-2 text-base font-semibold text-ink" {...p} />,
              p: (p) => <p className="mb-3 text-sm leading-relaxed text-ink-600" {...p} />,
              ul: (p) => <ul className="mb-3 list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-600" {...p} />,
              ol: (p) => <ol className="mb-3 list-decimal space-y-1.5 pl-5 text-sm leading-relaxed text-ink-600" {...p} />,
              a: ({ href, ...p }) => <a href={href} className="font-medium text-emerald-700 underline" rel="noopener noreferrer" {...p} />,
              strong: (p) => <strong className="font-semibold text-ink" {...p} />,
            }}
          >
            {article.body}
          </Markdown>
        </div>

        {category && (
          <p className="mt-8 border-t border-slate-100 pt-4 text-sm text-ink-600">
            Related:{" "}
            <Link href={`/services/${category.slug}`} className="font-medium text-emerald-700 hover:underline">
              {category.label} buyer&apos;s guide
            </Link>{" "}
            ·{" "}
            <Link href={`/compare?category=${category.slug}`} className="font-medium text-emerald-700 hover:underline">
              Compare providers
            </Link>
          </p>
        )}
        <p className="mt-4 text-[11px] text-slate-400">General information only, not legal, tax or investment advice.</p>
      </article>

      <CtaBand
        title="Want this applied to your fund?"
        body="Our independent advisors benchmark your providers and proposals against the market, paid only by you."
        primary={{ href: "/advisory#contact", label: "Talk to an advisor" }}
      />
    </main>
  );
}
