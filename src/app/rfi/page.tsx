import type { Metadata } from "next";
import Link from "next/link";
import { RequestForm } from "@/components/request-form";
import { listProviderOptions } from "@/db/queries";
import { ALL_SERVICES } from "@/lib/taxonomy";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Request quotes",
  description: "Send one standardized request for proposal to Luxembourg fund service providers. FundHub takes no referral fee.",
};

export default async function RfiPage({
  searchParams,
}: {
  searchParams: Promise<{ provider?: string; service?: string }>;
}) {
  const { provider, service } = await searchParams;
  const providers = await listProviderOptions();
  const preselected = providers.find((p) => p.slug === provider);
  const services = (service ?? "").split(",").filter((s) => ALL_SERVICES.includes(s));

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
      <h1 className="text-xl font-semibold text-ink">Request quotes (RFI)</h1>
      <p className="mt-1 text-sm text-ink-600">
        Describe your structure and the services you need, using our standardized service taxonomy. That way every
        proposal you receive covers the same scope. We route the request to the selected provider, or match you with a
        balanced shortlist if you leave it blank.
      </p>
      <p className="mt-2 mb-5 rounded-md bg-emerald-50 px-3 py-2 text-xs text-emerald-700">
        Want an expert to read the proposals for you?{" "}
        <Link href="/advisory?service=fee-audit#contact" className="font-semibold underline">
          Add an independent fee audit
        </Link>
        .
      </p>
      <RequestForm
        requestType="rfi"
        providers={providers}
        defaultProviderId={preselected?.id}
        defaultServices={services}
      />
    </main>
  );
}
