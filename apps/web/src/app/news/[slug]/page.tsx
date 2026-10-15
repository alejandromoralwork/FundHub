import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock } from "lucide-react";
import { CtaBand } from "@/components/marketing";
import { getInsight, INSIGHTS } from "@/content/insights";
import { getCategory } from "@fundhub/core/taxonomy";

type Props = { params: Promise<{ slug: string }> };

export function generateStaticParams() {
  return INSIGHTS.map((i) => ({ slug: i.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const i = getInsight((await params).slug);
  return i ? { title: i.title, description: i.summary } : { title: "Article not found" };
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric" });

export default async function InsightPage({ params }: Props) {
  const article = getInsight((await params).slug);
  if (!article) notFound();
  const category = article.category ? getCategory(article.category) : undefined;

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-8 p-4 sm:p-6">
      <Link href="/news" className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-600 hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> News & Learn
      </Link>

      <article className="rounded-lg border border-slate-200 bg-white p-6 sm:p-8">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-700">
          {article.kind === "news" ? "News" : "Learn"} · {article.topic}
        </p>
        <h1 className="mt-1 text-2xl font-semibold leading-snug text-ink">{article.title}</h1>
        <p className="mt-2 flex items-center gap-1.5 text-xs text-slate-400">
          {dateFmt.format(new Date(article.published))} · <Clock className="h-3 w-3" /> {article.readMinutes} min read
        </p>
        <p className="mt-5 text-base leading-relaxed text-ink-600">{article.summary}</p>

        <div className="mt-6 space-y-6">
          {article.sections.map((s, idx) => (
            <section key={idx}>
              {s.heading && <h2 className="mb-2 text-lg font-semibold text-ink">{s.heading}</h2>}
              {s.paragraphs?.map((p) => (
                <p key={p.slice(0, 32)} className="mb-3 text-sm leading-relaxed text-ink-600">
                  {p}
                </p>
              ))}
              {s.bullets && (
                <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-ink-600">
                  {s.bullets.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              )}
            </section>
          ))}
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
