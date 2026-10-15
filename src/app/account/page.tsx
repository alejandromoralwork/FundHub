import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, Clock, ExternalLink, LogOut, PenLine, ShieldCheck, XCircle } from "lucide-react";
import { ClaimForm } from "@/components/claim-form";
import { Panel } from "@/components/marketing";
import { getUserClaims } from "@/db/account-queries";
import { listProviderOptions } from "@/db/queries";
import { logout } from "@/lib/auth/actions";
import { requireUser } from "@/lib/auth/session";
import { categoryLabel } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "My account", robots: { index: false } };

const STATUS = {
  pending: { icon: Clock, label: "Pending review", cls: "bg-amber-50 text-amber-700" },
  approved: { icon: ShieldCheck, label: "Approved", cls: "bg-emerald-50 text-emerald-700" },
  rejected: { icon: XCircle, label: "Not approved", cls: "bg-red-50 text-red-700" },
} as const;

export default async function AccountPage() {
  const user = await requireUser();
  const [claims, providers] = await Promise.all([getUserClaims(user.id), listProviderOptions()]);
  const managed = claims.filter((c) => c.status === "approved" && c.providerSlug);
  const claimedIds = new Set(claims.map((c) => c.providerId));

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-700">Provider account</p>
          <h1 className="text-xl font-semibold text-ink">Welcome, {user.name}</h1>
          <p className="text-sm text-ink-600">{user.email}</p>
        </div>
        <div className="flex gap-2">
          {user.role === "admin" && (
            <Link href="/admin" className="rounded-md bg-ink-900 px-3 py-2 text-xs font-semibold text-white hover:bg-ink-800">
              Admin
            </Link>
          )}
          <form action={logout}>
            <button className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-ink-600 hover:bg-slate-50">
              <LogOut className="h-3.5 w-3.5" /> Log out
            </button>
          </form>
        </div>
      </div>

      <Panel>
        <h2 className="text-sm font-semibold text-ink">Your company profiles</h2>
        {managed.length ? (
          <ul className="mt-3 divide-y divide-slate-100">
            {managed.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <span className="text-sm font-medium text-ink">{c.providerName}</span>
                <span className="flex gap-2">
                  <Link
                    href={`/providers/${c.providerSlug}`}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-ink-600 hover:bg-slate-50"
                  >
                    View <ExternalLink className="h-3 w-3" />
                  </Link>
                  <Link
                    href={`/account/profiles/${c.providerSlug}`}
                    className="inline-flex items-center gap-1 rounded-md bg-emerald px-2.5 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700"
                  >
                    <PenLine className="h-3 w-3" /> Edit profile
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-ink-600">
            No approved profiles yet. Claim your company below; once FundHub confirms it, you can edit it here.
          </p>
        )}
      </Panel>

      {claims.length > 0 && (
        <Panel>
          <h2 className="text-sm font-semibold text-ink">Your claims</h2>
          <ul className="mt-3 divide-y divide-slate-100">
            {claims.map((c) => {
              const s = STATUS[c.status];
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                  <span>
                    <span className="font-medium text-ink">{c.providerName ?? c.proposedName}</span>
                    {!c.providerId && c.proposedCategory && (
                      <span className="text-xs text-slate-500"> · new listing · {categoryLabel(c.proposedCategory)}</span>
                    )}
                  </span>
                  <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>
                    <s.icon className="h-3 w-3" /> {s.label}
                  </span>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <h2 className="text-sm font-semibold text-ink">Claim a company</h2>
          <p className="mt-1 mb-4 text-xs text-ink-600">
            Tell us which company you represent. We verify claims before granting edit rights, so no one can edit a
            competitor&apos;s profile.
          </p>
          <ClaimForm providers={providers.filter((p) => !claimedIds.has(p.id))} />
        </Panel>
        <Panel>
          <BarChart3 className="h-5 w-5 text-emerald" />
          <h2 className="mt-2 text-sm font-semibold text-ink">Private Data Intelligence</h2>
          <p className="mt-1 text-xs leading-relaxed text-ink-600">
            Approved provider accounts can download private quarterly reports: fee distribution, demand trends and
            software penetration.
          </p>
          <Link href="/data-intelligence#reports" className="mt-3 inline-block text-xs font-medium text-emerald-700 hover:underline">
            Go to reports →
          </Link>
        </Panel>
      </div>
    </main>
  );
}
