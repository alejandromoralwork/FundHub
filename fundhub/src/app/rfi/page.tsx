import type { Metadata } from "next";
import { listProviderOptions } from "@/db/queries";
import { RfiForm } from "./rfi-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Request an RFI" };

export default async function RfiPage({ searchParams }: { searchParams: Promise<{ provider?: string }> }) {
  const { provider } = await searchParams;
  const providers = await listProviderOptions();
  const preselected = providers.find((p) => p.slug === provider);

  return (
    <main className="mx-auto w-full max-w-3xl flex-1 p-4 sm:p-6">
      <h1 className="text-xl font-semibold text-ink">Request an RFI / audit fee quote</h1>
      <p className="mt-1 mb-5 text-sm text-ink-600">
        Describe your structure and the services you need. We route the request to the selected provider, or match you
        with suitable ones if you leave it blank.
      </p>
      <RfiForm providers={providers} defaultProviderId={preselected?.id} />
    </main>
  );
}
