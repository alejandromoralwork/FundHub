/**
 * FILE: apps/web/src/app/awards/page.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The FundHub Market Awards page at /awards. It presents the award categories, how winners are
 *   scored, the annual calendar, a live box of today's peer-score leaders per category (from the database),
 *   and a nomination form.
 * WHERE IT RUNS: on the server (Node.js) as a React server component, so it can query the database for the
 *   leaders and the provider list. The nomination form is interactive in the browser.
 * FRAMEWORK NOTES: page.tsx inside app/awards/ = the page at /awards. `metadata` sets the tab title and the
 *   search-result description. `dynamic = "force-dynamic"` rebuilds the page on every request so the "live
 *   data" leaders are always current.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - `Promise.all` with array destructuring; `.map()` over data arrays to produce JSX lists.
 *   - template strings `` `${n} award categories` ``, the ternary `c ? a : b`, `.toFixed(1)`.
 */

// Imports (`import { a } from "b"` = use `a` from module `b`). "next..."/"lucide-react" = npm libraries;
// "@/..." = this app's src folder; "@fundhub/..." = FundHub's shared packages in packages/.
// `Metadata`: type for the page's <head> settings.
import type { Metadata } from "next";
// `Link`: Next.js link that changes page without a full reload.
import Link from "next/link";
// Icons (small SVG-drawing React components).
import { Award, BadgeCheck, CalendarDays, Scale, Trophy } from "lucide-react";
// Shared marketing building blocks: white card and section heading block.
import { Panel, SectionTitle } from "@/components/marketing";
// The enquiry form, used here in "awards" mode for nominations.
import { RequestForm } from "@/components/request-form";
// Draws a 0-5 star rating.
import { Stars } from "@/components/stars";
// The awards programme content (categories, scoring criteria, calendar), kept as shared data.
import { AWARD_CATEGORIES, AWARD_CRITERIA, AWARD_TIMELINE } from "@fundhub/core/awards";
// Database queries: top verified provider by peer score per category; and the provider list for the form.
import { getPeerScoreLeaders, listProviderOptions } from "@fundhub/db/queries";
// Turns a category code into its display label.
import { categoryLabel } from "@fundhub/core/taxonomy";

// Rebuild on every request (see FRAMEWORK NOTES).
export const dynamic = "force-dynamic";
/** Kind: constant (Next.js page metadata): tab title and the summary shown in search results. */
export const metadata: Metadata = {
  title: "FundHub Awards",
  description:
    "The FundHub Market Awards recognise the best Luxembourg fund service providers, decided on verified peer reviews, an independent jury and data.",
};

/**
 * Kind: async React component (the page).
 * Parameters: none.
 * Returns: Promise of JSX, the page markup.
 */
export default async function AwardsPage() {
  // Run both database queries at the same time and wait for both; name the two results.
  const [leaders, providers] = await Promise.all([getPeerScoreLeaders(), listProviderOptions()]);

  return (
    <main className="flex-1">
      {/* Dark full-width banner ("hero") at the top: `bg-ink-900` = very dark background, white text. */}
      <section className="bg-ink-900 text-white">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6">
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-widest text-emerald">
            <Trophy className="h-4 w-4" /> FundHub Market Awards
          </p>
          <h1 className="mt-3 max-w-3xl text-3xl font-semibold leading-tight">
            Recognising the best fund service providers in Luxembourg, on merit
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-relaxed text-slate-300">
            An annual, independent awards programme decided by verified client reviews, an independent jury and hard
            data, not by networks or marketing budgets. Boutiques compete on the same terms as global players.
          </p>
          {/* Two buttons that jump to sections further down this same page. A link starting with "#" points
              to the element with that `id`, so plain <a> tags are enough here. */}
          <div className="mt-6 flex flex-wrap gap-2">
            <a
              href="#nominate"
              className="rounded-md bg-emerald px-4 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700"
            >
              Nominate a provider
            </a>
            <a
              href="#categories"
              className="rounded-md border border-white/20 px-4 py-2.5 text-sm font-semibold text-white hover:bg-white/10"
            >
              Award categories
            </a>
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-6xl space-y-12 px-4 py-10 sm:px-6">
        {/* Categories. The title is a template string, so the count updates by itself if categories change. */}
        <section id="categories" className="scroll-mt-20">
          <SectionTitle eyebrow="Categories" title={`${AWARD_CATEGORIES.length} award categories`} />
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {AWARD_CATEGORIES.map((a) => (
              <div key={a.name} className="flex gap-3 rounded-lg border border-slate-200 bg-white p-4">
                <Award className="h-5 w-5 shrink-0 text-emerald" />
                <div>
                  <p className="text-sm font-semibold text-ink">{a.name}</p>
                  {/* Some awards belong to one provider category; others (no `category`) are open to all. */}
                  <p className="text-xs text-slate-500">{a.category ? categoryLabel(a.category) : "All categories"}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Two columns: the scoring criteria and the annual calendar. */}
        <section className="grid gap-6 lg:grid-cols-2">
          <div>
            <SectionTitle eyebrow="How winners are chosen" title="Scoring" />
            <ul className="mt-4 space-y-3">
              {/* Each criterion shows its weight (e.g. a percentage) beside its name and explanation. */}
              {AWARD_CRITERIA.map((c) => (
                <li key={c.label} className="flex gap-4 rounded-lg border border-slate-200 bg-white p-4">
                  <span className="tnum w-12 shrink-0 text-lg font-semibold text-emerald-700">{c.weight}</span>
                  <span>
                    <span className="block text-sm font-semibold text-ink">{c.label}</span>
                    <span className="text-xs text-ink-600">{c.body}</span>
                  </span>
                </li>
              ))}
            </ul>
            {/* Independence statement: money paid to FundHub never affects award results. */}
            <p className="mt-3 flex gap-2 text-xs leading-relaxed text-ink-600">
              <Scale className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              Participation fees cover the data audit and the event. They never influence results, and FundHub Pro
              subscriptions give no advantage. Only listed providers with verified data are eligible.
            </p>
          </div>
          <div>
            <SectionTitle eyebrow="Calendar" title="Annual timeline" />
            {/* <ol> = ordered (numbered) list, used because the steps happen in sequence. */}
            <ol className="mt-4 space-y-3">
              {AWARD_TIMELINE.map((t) => (
                <li key={t.what} className="flex gap-4 rounded-lg border border-slate-200 bg-white p-4">
                  <CalendarDays className="h-5 w-5 shrink-0 text-emerald" />
                  <span>
                    <span className="block text-xs font-semibold uppercase tracking-wide text-slate-500">{t.when}</span>
                    <span className="text-sm text-ink-600">{t.what}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Live leaders from the database: one card per category, each linking to the provider's profile. */}
        <section>
          <SectionTitle
            eyebrow="Live data"
            title="Current peer-score leaders"
            lead="The verified provider with the highest peer score in each category today. This is a live indicator, not an award result."
          />
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {leaders.map((p) => (
              <Link
                key={p.id}
                href={`/providers/${p.slug}`}
                className="rounded-lg border border-slate-200 bg-white p-4 hover:border-emerald/50"
              >
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">{categoryLabel(p.category)}</p>
                <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-ink">
                  <BadgeCheck className="h-3.5 w-3.5 shrink-0 text-emerald" /> {p.name}
                </p>
                {/* Star picture, the rating with one decimal (`.toFixed(1)`), and the number of reviews. */}
                <p className="mt-1 flex items-center gap-1">
                  <Stars score={p.rating} />
                  <span className="tnum text-xs font-medium">{p.rating.toFixed(1)}</span>
                  <span className="text-[11px] text-slate-400">({p.reviewCount})</span>
                </p>
              </Link>
            ))}
          </div>
        </section>

        {/* Nominations: explanation on the left (2/5), the form on the right (3/5). */}
        <section id="nominate" className="grid scroll-mt-20 gap-6 lg:grid-cols-5">
          <div className="lg:col-span-2">
            <SectionTitle
              eyebrow="Nominations"
              title="Nominate a provider or register interest"
              lead="Providers can nominate themselves; asset managers can recommend a provider they work with. We'll confirm eligibility and the next steps by email."
            />
            <Panel className="mt-4">
              <p className="text-sm text-ink-600">
                Are you a provider? Make sure your FundHub profile is complete and verified first.
              </p>
              <Link href="/account" className="mt-2 inline-block text-xs font-medium text-emerald-700 hover:underline">
                Go to your provider account →
              </Link>
            </Panel>
          </div>
          <div className="lg:col-span-3">
            {/* `requestType="awards"` makes the shared form show the nomination fields and label the request. */}
            <RequestForm requestType="awards" providers={providers} />
          </div>
        </section>
      </div>
    </main>
  );
}
