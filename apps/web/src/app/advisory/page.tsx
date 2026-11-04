/**
 * FILE: apps/web/src/app/advisory/page.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The main Advisory marketing page at /advisory. It presents FundHub's paid advisory services
 *   for asset managers (fee negotiation alongside the client, provider selection, fee audits, fund set-up),
 *   the conflict-free fee model, the four-step process, typical audit findings, an FAQ, and a request form.
 *   Links like /advisory?service=negotiation&provider=<slug> pre-fill the form.
 * WHERE IT RUNS: on the server (Node.js) as a React server component, because it reads the provider list from
 *   the database. The request form is interactive in the browser.
 * FRAMEWORK NOTES: page.tsx inside app/advisory/ = the page at /advisory. `searchParams` = the URL query
 *   string (after "?"), handed to the page as a Promise. `metadata` sets the tab title and search-engine
 *   description. `dynamic = "force-dynamic"` = rebuild on every request (it reads the query string and the
 *   database).
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - import renaming `Map as MapIcon`; object/array constants; `as const`.
 *   - `.find()` (returns the first match or `undefined`), `.map()` with an index `(p, i) => ...`.
 *   - optional chaining `a?.b`, ternary `c ? x : y`, `async`/`await`, destructuring of props.
 */

// Imports (`import { a } from "b"` = use `a` from module `b`). "next"/"lucide-react" = npm libraries;
// "@/..." = this app's src folder; "@fundhub/..." = FundHub's shared packages in packages/.
// `Metadata`: type for the page's <head> settings.
import type { Metadata } from "next";
// Icons. `Map as MapIcon` imports the icon called `Map` under a new name, because `Map` is also the name of a
// built-in JavaScript type and reusing it would be confusing (and would hide the built-in one).
import { Ban, Coins, FileSearch, Handshake, Map as MapIcon, ShieldCheck, Users } from "lucide-react";
// Shared marketing building blocks: bullet list, white card, section heading block.
import { CheckList, Panel, SectionTitle } from "@/components/marketing";
// The enquiry form that sends a request to FundHub.
import { RequestForm } from "@/components/request-form";
// Database query: id, slug and name of every provider, for the form's provider picker.
import { listProviderOptions } from "@fundhub/db/queries";
// The official list of advisory services (id, label, description), shared across the apps.
import { ADVISORY_SERVICES } from "@fundhub/core/request-options";

// Rebuild on every request (see FRAMEWORK NOTES).
export const dynamic = "force-dynamic";
/** Kind: constant (Next.js page metadata): tab title and the summary shown in search results. */
export const metadata: Metadata = {
  title: "Fund Set-up & Provider Fee Negotiation Advisory",
  description:
    "We accompany asset managers to negotiate fees with Luxembourg fund service providers and help them set up their activities. Paid only by you, never by providers.",
};

/**
 * Kind: constant (lookup table, `as const`). Which icon to show for each advisory service id.
 * Keys with a dash, like "fee-audit", must be written in quotes; plain words like `negotiation` need not be.
 */
const ICONS = { "fee-audit": FileSearch, "vendor-selection": Users, negotiation: Handshake, "fund-setup": MapIcon } as const;

/**
 * Kind: constant (array of objects). The four steps of an engagement, each with a `title` and a `body` text.
 */
const PROCESS = [
  { title: "Scoping call", body: "A free 30-minute call about your project: a new fund or activity, a renegotiation, or proposals you've received." },
  {
    title: "Data-driven diagnosis",
    body: "We benchmark your fees and scope against FundHub's market data and anonymized RFI and audit pools.",
  },
  {
    title: "Negotiation, with you in the room",
    body: "We prepare the negotiation, run a standardized RFP if needed, and attend the pricing meetings with you, physically or virtually.",
  },
  {
    title: "Set-up & onboarding",
    body: "We coordinate the set-up of your activities and providers in Luxembourg and accompany you through contracts and onboarding.",
  },
];

/**
 * Kind: constant (array of objects). Frequently asked questions: `q` = question, `a` = answer.
 * Several answers state FundHub's independence rule: no money from providers, ever.
 */
const FAQ = [
  {
    q: "Do you receive anything from the provider we choose?",
    a: "No. FundHub accepts no referral fees, commissions, retrocessions or reciprocal business from service providers. We confirm this in writing in every engagement letter.",
  },
  {
    q: "How is the success fee calculated?",
    a: "As a percentage of the first-year savings we capture against your baseline (your current fees or the best initial quote). The baseline and percentage are agreed before we start.",
  },
  {
    q: "Will you recommend providers that pay for a FundHub Pro account?",
    a: "Subscriptions have no influence on our advice, rankings, scores or the Verified badge. Shortlists are built from the full index using the criteria you set.",
  },
  {
    q: "We already have providers. Is an audit still worthwhile?",
    a: "Yes. Fee schedules drift through indexation, add-on services and changed scope. A retrospective invoice audit often finds savings without changing providers.",
  },
];

/**
 * Kind: async React component (the page).
 * Parameters: props destructured as `{ searchParams }`, typed `Promise<{ service?: string; provider?: string }>`:
 *   - `service`: optional advisory service id to pre-tick in the form (e.g. "fee-audit").
 *   - `provider`: optional provider slug to pre-select in the form (from a "Request advisory" button on a
 *     provider's profile).
 * Returns: Promise of JSX, the page markup.
 */
export default async function AdvisoryPage({
  searchParams,
}: {
  searchParams: Promise<{ service?: string; provider?: string }>;
}) {
  // Read the two optional query-string values.
  const { service, provider } = await searchParams;
  // Load every provider for the form's picker.
  const providers = await listProviderOptions();
  // Find the provider whose slug matches ?provider=..., or `undefined` if none (or no value was given).
  const preselected = providers.find((p) => p.slug === provider);
  // Same for the service: the matching entry from the official list, or `undefined`. Unknown values in the
  // URL are thus ignored safely.
  const preService = ADVISORY_SERVICES.find((s) => s.id === service);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-12 p-4 sm:p-6">
      {/* Top section: headline and intro (3/5 width) beside the "conflict-free mandate" card (2/5). */}
      <section className="grid gap-6 lg:grid-cols-5">
        <div className="lg:col-span-3">
          <SectionTitle
            as="h1"
            eyebrow="Fund Set-up & Provider Fee Negotiation Advisory"
            title="We sit at the table with you: set up in Luxembourg, pick the right providers, negotiate their fees"
            lead="Two things managers ask us for most: someone experienced on their side when negotiating fees with service providers, and a guide through setting up their fund and activities in Luxembourg. Law firms and administrators often recommend providers under referral fees; we don't. Our senior experts work only for you, backed by FundHub's market data."
          />
        </div>
        {/* `border-emerald/40`: Tailwind's "/40" means the colour at 40% opacity. */}
        <Panel className="border-emerald/40 lg:col-span-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-ink">
            <ShieldCheck className="h-4 w-4 text-emerald" /> Conflict-free mandate
          </p>
          {/* The three ways FundHub is (and is not) paid. `<strong>` makes text bold. */}
          <ul className="mt-3 space-y-2.5 text-sm text-ink-600">
            <li className="flex gap-2">
              <Coins className="mt-0.5 h-4 w-4 shrink-0 text-emerald" />
              <span>
                <strong className="text-ink">Flat advisory fee</strong> agreed up front, or
              </span>
            </li>
            <li className="flex gap-2">
              <Coins className="mt-0.5 h-4 w-4 shrink-0 text-emerald" />
              <span>
                <strong className="text-ink">Success fee</strong>: a percentage of the savings we capture.
              </span>
            </li>
            <li className="flex gap-2">
              <Ban className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
              <span>
                <strong className="text-ink">Zero</strong> referral fees, commissions or kickbacks from providers.
              </span>
            </li>
          </ul>
        </Panel>
      </section>

      {/* Services: one card per advisory service, built from the shared ADVISORY_SERVICES list. */}
      <section>
        <SectionTitle eyebrow="Services" title="What we do for asset managers" lead="Negotiation support and set-up support are our core services; fee audits and RFP management support both." />
        <div className="mt-5 grid gap-4 md:grid-cols-2">
          {/* The arrow function has a `{ }` body, so it uses an explicit `return`. `ICONS[s.id]` looks up the
              icon for this service; the variable is capitalised (`Icon`) so it can be used as a JSX tag. */}
          {ADVISORY_SERVICES.map((s) => {
            const Icon = ICONS[s.id];
            return (
              <Panel key={s.id}>
                <Icon className="h-5 w-5 text-emerald" />
                <h3 className="mt-3 text-sm font-semibold text-ink">{s.label}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{s.description}</p>
                {/* A plain <a> (not Link) reloading this page with ?service=... so the form below is pre-ticked
                    by the server; "#contact" then scrolls down to the form. */}
                <a href={`/advisory?service=${s.id}#contact`} className="mt-3 inline-block text-xs font-medium text-emerald-700 hover:underline">
                  Request this service →
                </a>
              </Panel>
            );
          })}
        </div>
      </section>

      {/* Process: a numbered list (<ol>) of the four steps. */}
      <section>
        <SectionTitle eyebrow="Process" title="How an engagement works" />
        <ol className="mt-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {/* `.map((p, i) => ...)`: the second argument `i` is the item's position, starting at 0, so
              `0{i + 1}` prints "01", "02", ... */}
          {PROCESS.map((p, i) => (
            <li key={p.title} className="rounded-lg border border-slate-200 bg-white p-5">
              <p className="font-mono text-xs text-emerald-700">0{i + 1}</p>
              <h3 className="mt-1 text-sm font-semibold text-ink">{p.title}</h3>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-600">{p.body}</p>
            </li>
          ))}
        </ol>
      </section>

      {/* Two columns: typical audit findings, and the FAQ. */}
      <section className="grid gap-6 lg:grid-cols-2">
        <div>
          <SectionTitle eyebrow="What our audits typically find" title="Where the money leaks" />
          <div className="mt-4">
            {/* `tone="negative"` makes CheckList draw red bullet dots instead of green ones. */}
            <CheckList
              tone="negative"
              items={[
                "Hidden per-SPV, per-investor and per-transaction line items",
                "Inflated out-of-pocket and 'technology' expenses",
                "Services bundled in that the fund doesn't need",
                "Minimum fees and indexation clauses out of line with the market",
                "Depositary or administration bundles priced above unbundled alternatives",
              ]}
            />
          </div>
        </div>
        <div>
          <SectionTitle eyebrow="FAQ" title="Common questions" />
          {/* <dl> is an HTML "description list": <dt> holds the term (question), <dd> its description (answer). */}
          <dl className="mt-4 space-y-4">
            {FAQ.map((f) => (
              <div key={f.q}>
                <dt className="text-sm font-semibold text-ink">{f.q}</dt>
                <dd className="mt-1 text-sm leading-relaxed text-ink-600">{f.a}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* The request form, reachable with #contact. */}
      <section id="contact" className="scroll-mt-20">
        <SectionTitle
          eyebrow="Get started"
          title="Request a free scoping call"
          lead="Tell us about your fund and what you need. Requests are confidential."
        />
        <div className="mt-5 max-w-3xl">
          {/* `preselected?.id`: the provider's id if one was found, otherwise `undefined` (no pre-selection).
              `preService ? [preService.label] : []`: pre-tick that one service, or none. */}
          <RequestForm
            requestType="advisory"
            providers={providers}
            defaultProviderId={preselected?.id}
            defaultServices={preService ? [preService.label] : []}
          />
        </div>
      </section>
    </main>
  );
}
