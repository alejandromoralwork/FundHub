import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { LEGAL } from "@/content/legal";

type Props = { params: Promise<{ page: string }> };

export function generateStaticParams() {
  return Object.keys(LEGAL).map((page) => ({ page }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = LEGAL[(await params).page];
  return p ? { title: p.title, description: p.description } : { title: "Not found" };
}

export default async function LegalPage({ params }: Props) {
  const { page } = await params;
  const doc = LEGAL[page];
  if (!doc) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-6 p-4 sm:p-6">
      <nav className="flex flex-wrap gap-3 text-xs">
        {Object.entries(LEGAL).map(([key, d]) => (
          <Link key={key} href={`/legal/${key}`} className={key === page ? "font-semibold text-ink" : "text-slate-500 hover:text-ink hover:underline"}>
            {d.title}
          </Link>
        ))}
        <Link href="/privacy-request" className="text-slate-500 hover:text-ink hover:underline">
          Data request
        </Link>
      </nav>
      <article className="rounded-lg border border-slate-200 bg-white p-6 sm:p-8">
        <h1 className="text-2xl font-semibold text-ink">{doc.title}</h1>
        <div className="mt-5 space-y-5">
          {doc.sections.map((s, i) => (
            <section key={i}>
              {s.heading && <h2 className="mb-2 text-base font-semibold text-ink">{s.heading}</h2>}
              {s.paragraphs?.map((p) => (
                <p key={p.slice(0, 40)} className="mb-2 text-sm leading-relaxed text-ink-600">
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
        {page === "privacy" && (
          <p className="mt-6 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">
            To access, correct or delete your data,{" "}
            <Link href="/privacy-request" className="font-semibold underline">
              submit a data request
            </Link>
            .
          </p>
        )}
      </article>
    </main>
  );
}
