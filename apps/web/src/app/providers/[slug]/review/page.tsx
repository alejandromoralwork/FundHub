import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, ShieldCheck } from "lucide-react";
import { ReviewForm } from "@/components/review-form";
import { getProviderBySlug } from "@fundhub/db/queries";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const p = await getProviderBySlug((await params).slug);
  return { title: p ? `Review ${p.name}` : "Provider not found", robots: { index: false } };
}

const STEPS = [
  "You rate the provider and describe your experience",
  "We check your work email and the client relationship you describe",
  "If verified, the review is published with your role and fund type only",
  "Its overall score is added to the provider's Peer Opinion Score",
];

export default async function WriteReviewPage({ params }: Props) {
  const p = await getProviderBySlug((await params).slug);
  if (!p) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 p-4 sm:p-6">
      <Link href={`/providers/${p.slug}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-600 hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> {p.name}
      </Link>
      <div>
        <h1 className="text-xl font-semibold text-ink">Write a verified review of {p.name}</h1>
        <p className="mt-1 text-sm text-ink-600">
          For asset managers and fund clients only. Reviews help other managers choose on evidence, not referrals.
        </p>
      </div>
      <div className="rounded-lg border border-emerald/30 bg-emerald-50 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <ShieldCheck className="h-4 w-4 text-emerald-700" /> How verification works
        </p>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-ink-600">
          {STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-ink-600">
          Providers can&apos;t edit, hide or pay for reviews, and their staff can&apos;t review themselves.
        </p>
      </div>
      <ReviewForm providerId={p.id} providerName={p.name} providerSlug={p.slug} />
    </main>
  );
}
