import Link from "next/link";
import { Clock } from "lucide-react";
import { articleHref } from "@/lib/articles";

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric" });

export type PostItem = { slug: string; kind: string; title: string; summary: string; topic: string; readMinutes: number; publishedAt: Date | null };

export function PostGrid({ items, empty }: { items: PostItem[]; empty: string }) {
  if (!items.length) return <p className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-sm text-slate-500">{empty}</p>;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {items.map((i) => (
        <Link
          key={i.slug}
          href={articleHref(i.kind, i.slug)}
          className="flex flex-col rounded-lg border border-slate-200 bg-white p-5 hover:border-emerald/50 hover:shadow-sm"
        >
          <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">{i.topic}</p>
          <h2 className="mt-1 text-base font-semibold text-ink">{i.title}</h2>
          <p className="mt-1.5 flex-1 text-sm leading-relaxed text-ink-600">{i.summary}</p>
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-slate-400">
            {i.publishedAt && dateFmt.format(i.publishedAt)} · <Clock className="h-3 w-3" /> {i.readMinutes} min read
          </p>
        </Link>
      ))}
    </div>
  );
}
