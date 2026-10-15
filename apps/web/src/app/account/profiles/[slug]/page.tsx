import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft, Lock } from "lucide-react";
import { ProfileEditor } from "@/components/profile-editor";
import { getRecentProfileEdits } from "@fundhub/db/account-queries";
import { getProviderBySlug } from "@fundhub/db/queries";
import { canManageProvider, requireUser } from "@/lib/auth/session";
import { formatPriceRange } from "@fundhub/core/format";
import { categoryLabel } from "@fundhub/core/taxonomy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Edit profile", robots: { index: false } };

const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function EditProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await requireUser(`/account/profiles/${slug}`);
  const provider = await getProviderBySlug(slug);
  if (!provider) notFound();
  if (!(await canManageProvider(user, provider.id))) redirect("/account");
  const edits = await getRecentProfileEdits(provider.id, 5);

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-4 p-4 sm:p-6">
      <Link href="/account" className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-600 hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> My account
      </Link>
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h1 className="text-xl font-semibold text-ink">{provider.name}</h1>
          <p className="text-sm text-slate-500">{categoryLabel(provider.category)}</p>
        </div>
        <Link href={`/providers/${provider.slug}`} className="text-xs font-medium text-emerald-700 hover:underline">
          View public profile →
        </Link>
      </div>

      <div className="flex gap-2 rounded-lg border border-slate-200 bg-canvas p-4 text-xs leading-relaxed text-ink-600">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <p>
          Managed independently by FundHub, not editable here: company name, primary category, fee range (
          <span className="tnum">{formatPriceRange(provider.priceMin, provider.priceMax)}</span>/qtr), set-up fee, peer
          score and reviews, and the Verified badge. To correct them, contact FundHub with supporting evidence.
        </p>
      </div>

      <ProfileEditor provider={provider} />

      {edits.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-ink">Recent changes</h2>
          <ul className="mt-2 space-y-1.5 text-xs text-ink-600">
            {edits.map((e) => (
              <li key={e.id}>
                <span className="tnum text-slate-400">{dateFmt.format(e.createdAt)}</span> · {e.userName ?? "Unknown"} updated{" "}
                {Object.keys(e.changes).join(", ")}
              </li>
            ))}
          </ul>
        </section>
      )}
    </main>
  );
}
