/**
 * FILE: apps/web/src/app/account/profiles/[slug]/page.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The "Edit profile" page where a service provider's representative updates their company's
 *   public listing, at /account/profiles/<company-slug>. It checks the visitor is logged in and is allowed to
 *   manage this company, explains which fields FundHub keeps control of, shows the editor form and lists the
 *   five most recent changes.
 * WHERE IT RUNS: on the server (Node.js) as a React server component, so it can read the database and the
 *   login cookie directly before sending HTML. The editor form inside it runs in the browser.
 * FRAMEWORK NOTES:
 *   - A folder name in square brackets, like [slug], is a "dynamic segment": it matches any value in that
 *     part of the URL. For /account/profiles/vianden-corporate-services, Next.js gives the page
 *     `params = { slug: "vianden-corporate-services" }` (as a Promise to await).
 *   - `notFound()` stops the page and shows the site's 404 "not found" page.
 *   - `redirect(url)` stops the page and sends the browser to `url`.
 *   - `export const dynamic = "force-dynamic"` tells Next.js never to pre-build or cache this page: it must
 *     be rebuilt on every request because it depends on who is logged in and on fresh database data.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `async`/`await`, `Promise<T>`, destructuring, template strings `` `text ${value}` ``.
 *   - the logical NOT `!`, `&&` used to show markup only when a condition holds, and `??` (nullish coalescing).
 *   - `new Intl.DateTimeFormat(...)`: creating an object from a built-in class with `new`.
 */

// Imports (`import { a } from "b"` = use `a` from module `b`). "next..."/"lucide-react" = npm libraries;
// "@/..." = this app's src folder; "@fundhub/..." = FundHub's own shared packages in packages/.
// `Metadata`: type for the page's <head> settings.
import type { Metadata } from "next";
// `Link`: Next.js link that changes page without a full reload.
import Link from "next/link";
// `notFound()` shows the 404 page; `redirect()` sends the browser elsewhere.
import { notFound, redirect } from "next/navigation";
// Icons: a left arrow (back link) and a padlock (fields FundHub locks).
import { ArrowLeft, Lock } from "lucide-react";
// The interactive form for editing the provider's own fields.
import { ProfileEditor } from "@/components/profile-editor";
// Database query: the latest profile edits for a provider (from packages/db).
import { getRecentProfileEdits } from "@fundhub/db/account-queries";
// Database query: one published provider by its URL slug.
import { getProviderBySlug } from "@fundhub/db/queries";
// Login helpers: `requireUser` forces a login; `canManageProvider` checks the user's approved company claim.
import { canManageProvider, requireUser } from "@/lib/auth/session";
// Turns a min/max fee pair into readable text such as "€5,000 – €10,000".
import { formatPriceRange } from "@fundhub/core/format";
// Turns a category code (e.g. "tax") into its display label.
import { categoryLabel } from "@fundhub/core/taxonomy";

// Always render fresh on each request (see FRAMEWORK NOTES): the page depends on the logged-in user.
export const dynamic = "force-dynamic";
// Page <head> settings: tab title, and `index: false` keeps this private page out of search engines.
export const metadata: Metadata = { title: "Edit profile", robots: { index: false } };

/**
 * Kind: constant (a date formatter object).
 * `Intl.DateTimeFormat` is built into JavaScript and formats dates for a locale; "en-GB" gives British
 * style, e.g. "4 Mar 2026, 14:05". Creating it once here (outside the component) means it is reused for every
 * row instead of being rebuilt each time.
 */
const dateFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

/**
 * Kind: async React component (the page).
 * Parameters: props destructured as `{ params }`, typed `Promise<{ slug: string }>`: the value of the [slug]
 *   part of the URL, i.e. which company is being edited.
 * Returns: Promise of JSX, the page markup (or it ends early via notFound/redirect).
 */
export default async function EditProfilePage({ params }: { params: Promise<{ slug: string }> }) {
  // Wait for the route parameters and take out the slug.
  const { slug } = await params;
  // Make sure someone is logged in. If not, `requireUser` redirects to the login page, passing this page's
  // address (built with a template string: backticks with `${slug}` inserted) so they come back afterwards.
  const user = await requireUser(`/account/profiles/${slug}`);
  // Load the company from the database.
  const provider = await getProviderBySlug(slug);
  // `!provider` = "provider is missing" (undefined). Unknown company: show the 404 page.
  if (!provider) notFound();
  // Security check: only representatives with an approved claim on this company may edit it.
  // `!(await ...)` waits for the yes/no answer and then flips it. Others are sent back to their account.
  if (!(await canManageProvider(user, provider.id))) redirect("/account");
  // The last 5 edits to this profile, for the "Recent changes" list.
  const edits = await getRecentProfileEdits(provider.id, 5);

  // `space-y-4` (Tailwind) adds vertical space between each direct child block.
  return (
    <main className="mx-auto w-full max-w-4xl flex-1 space-y-4 p-4 sm:p-6">
      {/* Back link to the account page, with a small arrow icon before the text. */}
      <Link href="/account" className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-600 hover:text-ink">
        <ArrowLeft className="h-3.5 w-3.5" /> My account
      </Link>
      {/* Header row: company name and category on the left, link to the public profile on the right.
          `flex justify-between` pushes the two ends apart; `flex-wrap` lets them stack on narrow screens. */}
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          {/* `{provider.name}` inserts a value from TypeScript into the markup. */}
          <h1 className="text-xl font-semibold text-ink">{provider.name}</h1>
          <p className="text-sm text-slate-500">{categoryLabel(provider.category)}</p>
        </div>
        {/* `href={...}` with a template string builds the link to /providers/<slug>. */}
        <Link href={`/providers/${provider.slug}`} className="text-xs font-medium text-emerald-700 hover:underline">
          View public profile →
        </Link>
      </div>

      {/* Notice listing the fields providers cannot edit themselves. This is the independence rule: FundHub,
          not the provider, sets fees, scores, reviews and the Verified badge. */}
      <div className="flex gap-2 rounded-lg border border-slate-200 bg-canvas p-4 text-xs leading-relaxed text-ink-600">
        <Lock className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
        <p>
          Managed independently by FundHub, not editable here: company name, primary category, fee range (
          {/* `tnum` = a custom class for tabular (equal-width) numbers so figures line up neatly. */}
          <span className="tnum">{formatPriceRange(provider.priceMin, provider.priceMax)}</span>/qtr), set-up fee, peer
          score and reviews, and the Verified badge. To correct them, contact FundHub with supporting evidence.
        </p>
      </div>

      {/* The editor form gets the whole provider record as a prop so it can pre-fill its fields. */}
      <ProfileEditor provider={provider} />

      {/* `condition && (markup)`: React shows the markup only when the condition is true. Here the
          "Recent changes" box only appears if there is at least one edit. */}
      {edits.length > 0 && (
        <section className="rounded-lg border border-slate-200 bg-white p-5">
          <h2 className="text-sm font-semibold text-ink">Recent changes</h2>
          <ul className="mt-2 space-y-1.5 text-xs text-ink-600">
            {/* One line per edit. `.map` returns an array of <li> elements; `key={e.id}` lets React track them.
                `e.userName ?? "Unknown"`: `??` uses the right-hand value only when the left is null/undefined
                (e.g. the editing user was deleted). `Object.keys(e.changes)` lists the names of the changed
                fields, and `.join(", ")` glues them into one comma-separated string. */}
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
