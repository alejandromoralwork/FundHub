import type { Metadata } from "next";
import Link from "next/link";
import { Award, BadgeCheck, CalendarDays, Scale, Trophy } from "lucide-react";
import { Panel, SectionTitle } from "@/components/marketing";
import { RequestForm } from "@/components/request-form";
import { Stars } from "@/components/stars";
import { AWARD_CATEGORIES, AWARD_CRITERIA, AWARD_TIMELINE } from "@/content/awards";
import { getPeerScoreLeaders, listProviderOptions } from "@/db/queries";
import { categoryLabel } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "FundHub Awards",
  description:
    "The FundHub Market Awards recognise the best Luxembourg fund service providers, decided on verified peer reviews, an independent jury and data.",
};

export default async function AwardsPage() {
  const [leaders, providers] = await Promise.all([getPeerScoreLeaders(), listProviderOptions()]);

  return (
    <main className="flex-1">
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
        <section id="categories" className="scroll-mt-20">
          <SectionTitle eyebrow="Categories" title={`${AWARD_CATEGORIES.length} award categories`} />
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {AWARD_CATEGORIES.map((a) => (
              <div key={a.name} className="flex gap-3 rounded-lg border border-slate-200 bg-white p-4">
                <Award className="h-5 w-5 shrink-0 text-emerald" />
                <div>
                  <p className="text-sm font-semibold text-ink">{a.name}</p>
                  <p className="text-xs text-slate-500">{a.category ? categoryLabel(a.category) : "All categories"}</p>
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="grid gap-6 lg:grid-cols-2">
          <div>
            <SectionTitle eyebrow="How winners are chosen" title="Scoring" />
            <ul className="mt-4 space-y-3">
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
            <p className="mt-3 flex gap-2 text-xs leading-relaxed text-ink-600">
              <Scale className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
              Participation fees cover the data audit and the event. They never influence results, and FundHub Pro
              subscriptions give no advantage. Only listed providers with verified data are eligible.
            </p>
          </div>
          <div>
            <SectionTitle eyebrow="Calendar" title="Annual timeline" />
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
                <p className="mt-1 flex items-center gap-1">
                  <Stars score={p.rating} />
                  <span className="tnum text-xs font-medium">{p.rating.toFixed(1)}</span>
                  <span className="text-[11px] text-slate-400">({p.reviewCount})</span>
                </p>
              </Link>
            ))}
          </div>
        </section>

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
            <RequestForm requestType="awards" providers={providers} />
          </div>
        </section>
      </div>
    </main>
  );
}
