/**
 * FILE: apps/web/src/app/advisory/fund-setup/page.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The marketing page for FundHub's "Fund set-up advisory" service, at /advisory/fund-setup.
 *   It explains the six areas we help with (structure, providers, budget, substance, timeline, onboarding),
 *   how we work (fixed fees, no referral commissions), and ends with a contact/request form pre-filled with
 *   this service.
 * WHERE IT RUNS: on the server (Node.js) as a React server component, because it reads the list of providers
 *   from the database for the request form. The form itself is interactive in the browser.
 * FRAMEWORK NOTES: page.tsx inside app/advisory/fund-setup/ = the page at /advisory/fund-setup. The exported
 *   `metadata` sets the tab title and the search-engine description. `dynamic = "force-dynamic"` makes Next.js
 *   build the page fresh on every request instead of once at build time (so the provider list is current
 *   and the build does not need a database).
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - arrays of objects as constant data; `.find()` to pick one item from an array.
 *   - the non-null assertion `!`: "trust me, this is not undefined".
 *   - destructuring with renaming `{ icon: Icon }` inside a `.map()` arrow function.
 *   - `async`/`await`.
 */

// Imports (`import { a } from "b"` = use `a` from module `b`). "next..."/"lucide-react" = npm libraries;
// "@/..." = this app's src folder; "@fundhub/..." = FundHub's shared packages in packages/.
// `Metadata`: type for the page's <head> settings.
import type { Metadata } from "next";
// `Link`: Next.js link that changes page without a full reload.
import Link from "next/link";
// Icons (small SVG-drawing React components) for the six service areas.
import { Building2, CalendarClock, Landmark, Scale, Users, Wallet } from "lucide-react";
// Shared marketing building blocks: a bullet list, a white card, and a page title block.
import { CheckList, Panel, SectionTitle } from "@/components/marketing";
// The contact/request form that sends an enquiry to FundHub.
import { RequestForm } from "@/components/request-form";
// Database query: id + name of every provider, for the form's "providers you are considering" picker.
import { listProviderOptions } from "@fundhub/db/queries";
// The official list of advisory services (id, label, description), shared with the form and the console.
import { ADVISORY_SERVICES } from "@fundhub/core/request-options";

// Build fresh on every request (see FRAMEWORK NOTES).
export const dynamic = "force-dynamic";
/**
 * Kind: constant (Next.js page metadata). `title` = browser-tab text; `description` = the summary search
 * engines show under the link in results.
 */
export const metadata: Metadata = {
  title: "Fund set-up advisory",
  description:
    "Independent support to set up a fund or management activity in Luxembourg: structure, required providers, budget, substance and timeline. Paid only by you.",
};

/**
 * Kind: constant. The "fund-setup" entry from the shared services list.
 * `.find(fn)` returns the first item where `fn` is true, or `undefined` if none matches. The `!` at the end
 * (non-null assertion) tells TypeScript "this will definitely be found", so it can be used without checking
 * for undefined. If someone ever renamed that id in the shared list, this would fail at run time.
 */
const SETUP = ADVISORY_SERVICES.find((s) => s.id === "fund-setup")!;

/**
 * Kind: constant (array of objects). The six help areas shown as cards. Each item has:
 * `icon` (an icon component), `title` (card heading) and `body` (card text).
 */
const AREAS = [
  { icon: Scale, title: "Structure", body: "Comparing the options (e.g. RAIF, SIF, SICAV, SCSp) against your strategy, investors and distribution plans, together with your legal counsel." },
  { icon: Landmark, title: "Required providers", body: "Which providers the structure legally needs (AIFM or ManCo, depositary, administrator, auditor, domiciliation) and a conflict-free shortlist for each." },
  { icon: Wallet, title: "Realistic budget", body: "Set-up and running costs built from FundHub's fee benchmarks, so you know the total expense ratio before you commit." },
  { icon: Building2, title: "Substance", body: "Office, local directors, staff and governance that meet CSSF expectations without overbuilding." },
  { icon: CalendarClock, title: "Timeline", body: "A realistic plan from first call to first closing, including CSSF approval where needed and provider onboarding." },
  { icon: Users, title: "Onboarding", body: "We coordinate KYC, contracts and service-level agreements across providers, and attend kick-off meetings with you." },
];

/**
 * Kind: async React component (the page).
 * Parameters: none.
 * Returns: Promise of JSX, the page markup.
 */
export default async function FundSetupPage() {
  // Load the provider list for the request form (waits for the database).
  const providers = await listProviderOptions();
  return (
    <main className="mx-auto w-full max-w-6xl flex-1 space-y-10 p-4 sm:p-6">
      {/* Page heading block. `as="h1"` makes this title the page's main <h1> heading (good for SEO);
          `eyebrow` is the small label above it, `lead` the intro paragraph below it. */}
      <SectionTitle
        as="h1"
        eyebrow="Advisory · Fund set-up"
        title="Set up your fund or activity in Luxembourg, with an independent guide"
        lead="Launching a first fund, adding a new strategy or moving activities to Luxembourg means choosing a structure and several providers at once. We coordinate the whole set-up on your side, with no referral fees from anyone we recommend."
      />

      {/* Grid of six cards: 1 column on phones, 2 on small screens, 3 on large screens. */}
      <section className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {/* `({ icon: Icon, title, body })` destructures each item and renames `icon` to `Icon`: React only
            treats a tag as a component when its name starts with a capital letter, so `<Icon />` works. */}
        {AREAS.map(({ icon: Icon, title, body }) => (
          <Panel key={title}>
            <Icon className="h-5 w-5 text-emerald" />
            <h2 className="mt-2 text-sm font-semibold text-ink">{title}</h2>
            <p className="mt-1 text-sm leading-relaxed text-ink-600">{body}</p>
          </Panel>
        ))}
      </section>

      {/* Bottom section: "How we work" (2/5 width on large screens) and the request form (3/5). */}
      <section className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-2">
          <h2 className="text-base font-semibold text-ink">How we work</h2>
          {/* `items={[...]}` passes an array of strings as a prop; CheckList draws each with a green bullet dot. */}
          <CheckList
            items={[
              "Fixed fee per phase, agreed before we start. Paid only by you.",
              "We work alongside your legal counsel; we don't replace legal or tax advice.",
              "Every provider shortlist comes from the full FundHub index, ranked with the public FundHub Score.",
              "No referral fees, commissions or retrocessions from any provider, confirmed in writing.",
            ]}
          />
          <p className="text-sm text-ink-600">
            Already set up and want better terms?{" "}
            <Link href="/advisory" className="font-medium text-emerald-700 hover:underline">
              Provider selection & fee negotiation
            </Link>
            .
          </p>
        </div>
        {/* `id="contact"` lets buttons elsewhere jump here with #contact. The form is pre-ticked with the
            fund set-up service via `defaultServices={[SETUP.label]}` (an array with one label in it). */}
        <div id="contact" className="scroll-mt-20 lg:col-span-3">
          <RequestForm requestType="advisory" providers={providers} defaultServices={[SETUP.label]} />
        </div>
      </section>
    </main>
  );
}
