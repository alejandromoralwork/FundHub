/**
 * FILE: apps/web/src/app/rfi/page.tsx
 * PART: website (apps/web)
 * WHAT IT DOES: The /rfi ("request for information" / request quotes) page. A fund buyer describes their
 *   fund and the services they need, and FundHub forwards one standard request to a chosen provider (or
 *   builds a shortlist). Links elsewhere can pre-fill the form, e.g. /rfi?provider=acme&service=NAV,TA.
 * WHERE IT RUNS: the page is a server component (runs on the server, reads the database); RequestForm inside
 *   it is a client component that runs in the browser because it is interactive.
 * FRAMEWORK NOTES:
 *   - page.tsx = a web page; folder path = URL (app/rfi/page.tsx -> /rfi).
 *   - `searchParams`: Next.js passes the URL's query string (the part after "?") to the page as an object,
 *     wrapped in a Promise. `?provider=acme` becomes `{ provider: "acme" }`.
 *   - `metadata` sets the <title>/description; `dynamic = "force-dynamic"` renders on every visit.
 * TYPESCRIPT YOU WILL SEE HERE:
 *   - inline prop types `{ searchParams: Promise<{ provider?: string; ... }> }`; `?:` = optional property.
 *   - nullish coalescing `a ?? b`, optional chaining `a?.b`.
 *   - array methods `.find` (first match or undefined), `.split` (text -> array), `.filter`, `.includes`.
 */

// `import { a } from "b"` loads named exports ("next" = npm library; "@/..." = this app's src folder;
// "@fundhub/..." = our shared packages). `import X from "b"` loads the default export.
// Metadata: the Next.js type for page title/description data.
import type { Metadata } from "next";
// Link: Next.js in-site link without a full reload.
import Link from "next/link";
// RequestForm: the interactive request form, shared by several request types (here "rfi").
import { RequestForm } from "@/components/request-form";
// listProviderOptions: database query returning every published provider's id, slug and name.
import { listProviderOptions } from "@fundhub/db/queries";
// ALL_SERVICES: the flat list of every valid sub-service name in our standard taxonomy.
import { ALL_SERVICES } from "@fundhub/core/taxonomy";

/** Kind: constant (Next.js setting). Render on every request. */
export const dynamic = "force-dynamic";
/** Kind: constant (Next.js metadata). Tab title "Request quotes · FundHub" plus description. */
export const metadata: Metadata = {
  title: "Request quotes",
  description: "Send one standardized request for proposal to Luxembourg fund service providers. FundHub takes no referral fee.",
};

/**
 * Kind: async React component (server component) — the page.
 * @param searchParams  type `Promise<{ provider?: string; service?: string }>`: the URL query string.
 *                      `provider` = a provider slug to pre-select; `service` = comma-separated service names.
 *                      Both are optional (`?:`) because the visitor may arrive with no query string.
 * @returns             `Promise<JSX>`: intro text and the pre-filled request form.
 */
export default async function RfiPage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string; service?: string }>;
}) {
  // Wait for the query values and pull out the two we use.
  const { provider, service } = await searchParams;
  // All published providers, for the form's provider drop-down.
  const providers = await listProviderOptions();
  // `.find` returns the first provider whose slug matches `?provider=`, or undefined if none does.
  const preselected = providers.find((p) => p.slug === provider);
  // `service ?? ""` uses an empty text if no service was given. `.split(",")` cuts it into an array at commas;
  // `.filter(...)` keeps only names that really exist in ALL_SERVICES, so junk in the URL is ignored.
  const services = (service ?? "").split(",").filter((s) => ALL_SERVICES.includes(s));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
      <h1 className="text-xl font-semibold text-ink">Request quotes (RFI)</h1>
      <p className="mt-1 text-sm text-ink-600">
        Describe your structure and the services you need, using our standardized service taxonomy. That way every
        proposal you receive covers the same scope. We route the request to the selected provider, or match you with a
        balanced shortlist if you leave it blank.
      </p>
      {/* Green note cross-selling the fee audit. The link jumps to the #contact part of the advisory page with
          the fee-audit service pre-selected. `{" "}` keeps the space before the link. */}
      <p className="mt-2 mb-5 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
        Want an expert to read the proposals for you?{" "}
        <Link href="/advisory?service=fee-audit#contact" className="font-semibold underline">
          Add an independent fee audit
        </Link>
        .
      </p>
      {/* The form. `preselected?.id` = the provider's id if one was pre-selected, otherwise undefined. */}
      <RequestForm
        requestType="rfi"
        providers={providers}
        defaultProviderId={preselected?.id}
        defaultServices={services}
      />
    </main>
  );
}
