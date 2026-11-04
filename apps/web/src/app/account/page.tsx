/**
 * FILE: apps/web/src/app/account/page.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The "My account" dashboard at /account. Every logged-in user sees their saved providers and
 *   the reviews they wrote. Provider accounts also see the company profiles they manage, the status of their
 *   company claims, a form to claim a company, and a link to the private reports. Visitor accounts see an
 *   offer to switch to a provider account. It also has the "Log out" button.
 * WHERE IT RUNS: on the server (Node.js) as a React server component: it reads the login cookie and the
 *   database before sending HTML. The two small forms (log out, switch account type) call "server actions",
 *   functions that run on the server when the button is pressed.
 * FRAMEWORK NOTES:
 *   - app/account/page.tsx is the page at /account (the folder path becomes the URL).
 *   - `export const dynamic = "force-dynamic"`: never cache or pre-build; build it fresh for each request,
 *     because the content is personal to the logged-in user.
 *   - `<form action={someServerAction}>`: in Next.js a form's action can be a server function; submitting
 *     the form runs it on the server, no separate API needed.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `as const`: freeze an object's values to their exact literal types (e.g. "pending", not any string).
 *   - `async`/`await`, `Promise.all([...])` to run several database queries at the same time.
 *   - array destructuring `const [a, b] = array`, arrow functions, `.map`, `.filter`, `new Set(...)`.
 *   - ternary `c ? a : b`, `&&`, `!`, `??`, template strings `` `...${x}...` ``.
 */

// Imports (`import { a } from "b"` = use `a` from module `b`). "next..."/"lucide-react" = npm libraries;
// "@/..." = this app's src folder; "@fundhub/..." = FundHub's shared packages in packages/.
// `Metadata`: type for the page's <head> settings.
import type { Metadata } from "next";
// `Link`: Next.js link that changes page without a full reload.
import Link from "next/link";
// Icons from the Lucide icon library, each a small React component that draws an SVG picture.
import { BadgeCheck, BarChart3, Bookmark, Building2, Clock, ExternalLink, LogOut, PenLine, ShieldCheck, Star, XCircle } from "lucide-react";
// Turns a category code into its display label.
import { categoryLabel } from "@fundhub/core/taxonomy";
// Formats a min/max fee pair as "€x – €y".
import { formatPriceRange } from "@fundhub/core/format";
// Database queries for this user's shortlist, company claims and reviews.
import { getSavedProviders, getUserClaims, getUserReviews } from "@fundhub/db/account-queries";
// Database query: a short list (id + name) of all providers, used for the claim form's dropdown.
import { listProviderOptions } from "@fundhub/db/queries";
// The interactive "claim a company" form.
import { ClaimForm } from "@/components/claim-form";
// `Panel`: a reusable white card with a border, shared by the marketing pages.
import { Panel } from "@/components/marketing";
// Server actions: `becomeProvider` switches the account to a provider account; `logout` ends the session.
import { becomeProvider, logout } from "@/lib/auth/actions";
// Returns the logged-in user, or redirects to the login page if nobody is logged in.
import { requireUser } from "@/lib/auth/session";

// Always render fresh per request (see FRAMEWORK NOTES).
export const dynamic = "force-dynamic";
// Tab title, and `index: false` keeps this private page out of search engines.
export const metadata: Metadata = { title: "My account", robots: { index: false } };

/**
 * Kind: constant (lookup table), marked `as const` so TypeScript knows its exact keys and values.
 * Maps each company-claim status to how it is displayed: the icon component, the label text, and the
 * Tailwind colour classes (`cls`) for the little coloured badge (amber = waiting, green = yes, red = no).
 */
const STATUS = {
  pending: { icon: Clock, label: "Pending review", cls: "bg-amber-50 text-amber-700" },
  approved: { icon: ShieldCheck, label: "Approved", cls: "bg-emerald-50 text-emerald-700" },
  rejected: { icon: XCircle, label: "Not approved", cls: "bg-red-50 text-red-700" },
} as const;

/**
 * Kind: constant (lookup table). Maps a review's moderation status to the wording shown to its author.
 * Reviews must be verified by FundHub before they are published.
 */
const REVIEW_STATUS = { pending: "Awaiting verification", approved: "Published", rejected: "Not published" } as const;

/**
 * Kind: async React component (the page).
 * Parameters: none (it finds the user from the login cookie).
 * Returns: Promise of JSX, the dashboard markup.
 */
export default async function AccountPage() {
  // Get the logged-in user; anyone not logged in is redirected to the login page here.
  const user = await requireUser();
  // `===` means "is exactly equal to". True for service-provider accounts.
  const isProvider = user.accountType === "provider";
  // `Promise.all([...])` starts all four queries at once and waits until every one has finished, which is
  // faster than running them one after another. The results come back in the same order, and the array
  // destructuring `const [saved, myReviews, ...]` names each one.
  // Claims and the provider list only matter for provider accounts; for visitors we skip the database and
  // use `Promise.resolve([])`, a Promise that immediately gives an empty array.
  const [saved, myReviews, claims, providers] = await Promise.all([
    getSavedProviders(user.id),
    getUserReviews(user.id),
    isProvider ? getUserClaims(user.id) : Promise.resolve([]),
    isProvider ? listProviderOptions() : Promise.resolve([]),
  ]);
  // `.filter(fn)` returns a new array with only the items where `fn` is true: here, approved claims that are
  // linked to an existing listing (`c.providerSlug` is set). These are the profiles the user may edit.
  const managed = claims.filter((c) => c.status === "approved" && c.providerSlug);
  // A `Set` is a collection of unique values with a fast "does it contain X?" check (`.has`). It holds the IDs
  // of companies this user has already claimed, so the claim form can hide them.
  const claimedIds = new Set(claims.map((c) => c.providerId));

  return (
    <main className="mx-auto w-full max-w-5xl flex-1 space-y-6 p-4 sm:p-6">
      {/* Header: account type, greeting and email on the left; the log-out button on the right. */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          {/* `text-[11px]`: Tailwind square brackets allow an exact custom value (11 pixels). */}
          <p className="text-[11px] font-semibold uppercase tracking-widest text-emerald-700">
            {isProvider ? "Service provider account" : "Fund manager / visitor account"}
          </p>
          <h1 className="text-xl font-semibold text-ink">Welcome, {user.name}</h1>
          <p className="text-sm text-ink-600">{user.email}</p>
        </div>
        {/* Submitting this form runs the `logout` server action on the server (clears the session cookie). */}
        <form action={logout}>
          <button className="inline-flex items-center gap-1.5 rounded-md border border-slate-200 px-3 py-2 text-xs font-medium text-ink-600 hover:bg-slate-50">
            <LogOut className="h-3.5 w-3.5" /> Log out
          </button>
        </form>
      </div>

      {/* Provider-only section. `isProvider && (...)` shows it only for provider accounts.
          `<>...</>` is a "fragment": it groups several elements without adding an extra HTML tag. */}
      {isProvider && (
        <>
          {/* Card 1: the company profiles this user may edit. */}
          <Panel>
            <h2 className="text-sm font-semibold text-ink">Your company profiles</h2>
            {/* `managed.length ? A : B`: a length of 0 counts as false, so B (the "none yet" text) shows when
                the list is empty. */}
            {managed.length ? (
              <ul className="mt-3 divide-y divide-slate-100">
                {/* One row per managed company, each with "View" and "Edit profile" buttons. */}
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

          {/* Card 2: every claim the user has made and its status. Only shown when there is at least one. */}
          {claims.length > 0 && (
            <Panel>
              <h2 className="text-sm font-semibold text-ink">Your claims</h2>
              <ul className="mt-3 divide-y divide-slate-100">
                {/* This arrow function has a body in `{ }`, so it needs an explicit `return`. It first looks up
                    the display settings for the claim's status in the STATUS table. */}
                {claims.map((c) => {
                  const s = STATUS[c.status];
                  return (
                    <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-sm">
                      <span>
                        {/* Existing listing: its name. Proposed new listing: the name the user typed (`??`
                            falls back to it when providerName is null). */}
                        <span className="font-medium text-ink">{c.providerName ?? c.proposedName}</span>
                        {/* No providerId means "propose a new listing"; then also show the proposed category. */}
                        {!c.providerId && c.proposedCategory && (
                          <span className="text-xs text-slate-500"> · new listing · {categoryLabel(c.proposedCategory)}</span>
                        )}
                      </span>
                      {/* A template string mixes fixed classes with the status colour classes from `s.cls`. */}
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>
                        {/* `<s.icon />`: the icon component stored in the table is drawn like any other tag. */}
                        <s.icon className="h-3 w-3" /> {s.label}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}

          {/* Two cards side by side on large screens: the claim form (2/3 width) and the reports teaser. */}
          <div className="grid gap-6 lg:grid-cols-3">
            {/* `scroll-mt-20` leaves room above when the page jumps to #claim, so the sticky header doesn't
                hide the heading. */}
            <Panel className="scroll-mt-20 lg:col-span-2">
              {/* `id="claim"` lets other pages link straight here with /account#claim. */}
              <h2 id="claim" className="text-sm font-semibold text-ink">
                Claim a company
              </h2>
              <p className="mt-1 mb-4 text-xs text-ink-600">
                Tell us which company you represent. We verify claims before granting edit rights, so no one can edit a
                competitor&apos;s profile.
              </p>
              {/* Offer only companies not already claimed by this user (`!claimedIds.has(p.id)`). */}
              <ClaimForm providers={providers.filter((p) => !claimedIds.has(p.id))} />
            </Panel>
            <Panel>
              <BarChart3 className="h-5 w-5 text-emerald" />
              <h2 className="mt-2 text-sm font-semibold text-ink">Private Data Intelligence</h2>
              <p className="mt-1 text-xs leading-relaxed text-ink-600">
                Provider accounts with an approved company can download private quarterly reports: fee distribution,
                demand trends and software penetration.
              </p>
              <Link href="/data-intelligence#reports" className="mt-3 inline-block text-xs font-medium text-emerald-700 hover:underline">
                Go to reports →
              </Link>
            </Panel>
          </div>
        </>
      )}

      {/* Section shown to everyone: saved providers and own reviews, side by side on large screens. */}
      <div className="grid gap-6 lg:grid-cols-2">
        <Panel>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Bookmark className="h-4 w-4 text-emerald" /> Saved providers ({saved.length})
          </h2>
          {saved.length ? (
            <ul className="mt-3 divide-y divide-slate-100">
              {saved.map((p) => (
                <li key={p.id} className="py-2.5">
                  {/* The whole row is one link. `group` + `group-hover:underline` (below) underlines the name
                      when the mouse is anywhere over the row. */}
                  <Link href={`/providers/${p.slug}`} className="group flex items-center justify-between gap-3">
                    <span className="min-w-0">
                      <span className="flex items-center gap-1.5 truncate text-sm font-medium text-ink group-hover:underline">
                        {/* Verified providers get a small badge icon before their name. */}
                        {p.verified && <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-emerald" />}
                        {p.name}
                      </span>
                      <span className="text-xs text-slate-500">{categoryLabel(p.category)}</span>
                    </span>
                    <span className="shrink-0 text-right text-xs text-slate-500 tnum">
                      {formatPriceRange(p.priceMin, p.priceMax)}/qtr
                      {/* `.toFixed(1)` turns a number into text with one decimal place, e.g. 4.25 -> "4.3". */}
                      <span className="block">{p.rating.toFixed(1)} ★</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-ink-600">
              Use “Save” on any provider profile to build your shortlist.{" "}
              <Link href="/compare" className="font-medium text-emerald-700 hover:underline">
                Browse providers
              </Link>
            </p>
          )}
        </Panel>

        <Panel>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <Star className="h-4 w-4 text-emerald" /> Your reviews ({myReviews.length})
          </h2>
          {myReviews.length ? (
            <ul className="mt-3 divide-y divide-slate-100">
              {myReviews.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                  <span className="min-w-0">
                    <Link href={`/providers/${r.providerSlug}`} className="block truncate font-medium text-ink hover:underline">
                      {r.providerName}
                    </Link>
                    <span className="block truncate text-xs text-slate-500">“{r.title}”</span>
                  </span>
                  {/* Look up the friendly wording for the review's status in REVIEW_STATUS. */}
                  <span className="shrink-0 text-xs text-slate-500">{REVIEW_STATUS[r.status]}</span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-ink-600">
              Worked with a provider? Open its profile and choose “Write a verified review”.
            </p>
          )}
        </Panel>
      </div>

      {/* Visitor-only card: invite people who work for a provider to switch account type. The form runs the
          `becomeProvider` server action. */}
      {!isProvider && (
        <Panel className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-3">
            <Building2 className="h-5 w-5 shrink-0 text-emerald" />
            <div>
              <h2 className="text-sm font-semibold text-ink">Do you work for a fund service provider?</h2>
              <p className="text-xs text-ink-600">Switch to a provider account to claim and manage your company profile.</p>
            </div>
          </div>
          <form action={becomeProvider}>
            <button className="rounded-md border border-slate-300 px-3 py-2 text-xs font-semibold text-ink hover:bg-slate-50">
              Switch to provider account
            </button>
          </form>
        </Panel>
      )}
    </main>
  );
}
