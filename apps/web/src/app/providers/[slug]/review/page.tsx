/**
 * FILE: apps/web/src/app/providers/[slug]/review/page.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The "write a verified review" page for one provider, at /providers/<slug>/review.
 *   It explains how reviews are verified and shows the review form. Unknown providers get a 404.
 * WHERE IT RUNS: the page is a server component (runs on the server and reads the database); the form inside
 *   it (ReviewForm) is a client component that runs in the browser because it is interactive.
 * FRAMEWORK NOTES:
 *   - page.tsx = a web page; folder path = URL. [slug] is a "dynamic segment": Next.js passes the matching URL
 *     part as `params.slug`. The `review` sub-folder adds "/review" after it.
 *   - `dynamic = "force-dynamic"`: build the page fresh on every visit (provider data can change).
 *   - `generateMetadata`: Next.js hook for a data-dependent <title>. `robots: { index: false }` adds a
 *     "noindex" tag so search engines do not list this form page.
 *   - `notFound()`: show the 404 page.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - type alias `type Props = {...}`; `Promise<T>` with `await`.
 *   - ternary `cond ? a : b`; template strings `` `Review ${p.name}` ``.
 *   - an array constant and `.map` to turn it into list items.
 */

// `import { a } from "b"` loads named exports ("next", "lucide-react" = npm libraries; "@/..." = this app's
// src folder; "@fundhub/..." = our shared packages). `import X from "b"` loads the default export.
// Metadata: the Next.js type for page title/description data.
import type { Metadata } from "next";
// Link: Next.js in-site link without a full reload.
import Link from "next/link";
// notFound: shows the 404 page.
import { notFound } from "next/navigation";
// Icons from the Lucide library: a left arrow and a shield with a tick.
import { ArrowLeft, ShieldCheck } from "lucide-react";
// ReviewForm: the interactive review form (ratings, text, work email...).
import { ReviewForm } from "@/components/review-form";
// getProviderBySlug: database query for one published provider, or undefined if none has that slug.
import { getProviderBySlug } from "@fundhub/db/queries";

/** Kind: constant (Next.js setting). Render on every request. */
export const dynamic = "force-dynamic";

/** Kind: type alias. Next.js gives the page `params`: a Promise of `{ slug: string }` (the URL's [slug]). */
type Props = { params: Promise<{ slug: string }> };

/**
 * Kind: async function (Next.js metadata hook).
 * @param params  the URL's slug, as a Promise (destructured from the props with `{ params }`).
 * @returns       `Promise<Metadata>`: title "Review <provider name>", or "Provider not found"; never indexed.
 */
export async function generateMetadata({ params }: Props): Promise<Metadata> {
  // Wait for params, read `.slug`, and look the provider up in the database.
  const p = await getProviderBySlug((await params).slug);
  return { title: p ? `Review ${p.name}` : "Provider not found", robots: { index: false } };
}

/**
 * Kind: constant (array of strings). The four steps of review verification, shown as a numbered list.
 * Kept outside the component because it never changes.
 */
const STEPS = [
  "You rate the provider and describe your experience",
  "We check your work email and the client relationship you describe",
  "If verified, the review is published with your role and fund type only",
  "Its overall score is added to the provider's Peer Opinion Score",
];

/**
 * Kind: async React component (server component) — the page.
 * @param params  the URL's slug, as a Promise.
 * @returns       `Promise<JSX>`: back link, intro, verification box and the review form.
 */
export default async function WriteReviewPage({ params }: Props) {
  // Same lookup as in generateMetadata (Next.js runs both; each needs the provider).
  const p = await getProviderBySlug((await params).slug);
  // No such published provider: show the 404 page. After this line TypeScript knows `p` is defined.
  if (!p) notFound();

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 space-y-5 p-4 sm:p-6">
      {/* Back link to the provider's profile, with an arrow icon (`inline-flex items-center` lines them up). */}
      <Link href={`/providers/${p.slug}`} className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-600 hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> {p.name}
      </Link>
      <div>
        <h1 className="text-xl font-semibold text-ink">Write a verified review of {p.name}</h1>
        <p className="mt-1 text-sm text-ink-600">
          For asset managers and fund clients only. Reviews help other managers choose on evidence, not referrals.
        </p>
      </div>
      {/* Pale green box explaining verification. `border-emerald/30` = emerald border at 30% opacity. */}
      <div className="rounded-lg border border-emerald/30 bg-emerald-50 p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-ink">
          <ShieldCheck className="h-4 w-4 text-emerald-700" /> How verification works
        </p>
        {/* Numbered list (`list-decimal`): `.map` turns each step text into an <li>; the text is the key. */}
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-ink-600">
          {STEPS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
        <p className="mt-2 text-xs text-ink-600">
          Providers can&apos;t edit, hide or pay for reviews, and their staff can&apos;t review themselves.
        </p>
      </div>
      {/* The form gets the provider's id (saved with the review), name (for labels) and slug (for links). */}
      <ReviewForm providerId={p.id} providerName={p.name} providerSlug={p.slug} />
    </main>
  );
}
