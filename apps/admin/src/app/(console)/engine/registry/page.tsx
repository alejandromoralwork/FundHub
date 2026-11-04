/**
 * FILE: apps/admin/src/app/(console)/engine/registry/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The registry list of all entities, with search and filters taken from the URL.
 * WHERE IT RUNS: on the server; data from lib/engine-data.ts, drawn by components/engine-registry.tsx.
 */

import type { Metadata } from "next";
import { EngineUnavailable } from "@/components/engine-overview";
import { RegistryList } from "@/components/engine-registry";
import { CAN, requireStaff } from "@/lib/auth";
import { categoryOptions, registryList, type RegistryFilters } from "@/lib/engine-data";

export const metadata: Metadata = { title: "Registry" };
export const dynamic = "force-dynamic";

export default async function RegistryPage({ searchParams }: { searchParams: Promise<RegistryFilters> }) {
  await requireStaff(CAN.engine);
  const filters = await searchParams;
  try {
    const [list, categories] = await Promise.all([registryList(filters), categoryOptions()]);
    return <RegistryList list={list} filters={filters} categories={categories} />;
  } catch (err) {
    return <EngineUnavailable error={err instanceof Error ? err.message : String(err)} />;
  }
}
