/**
 * FILE: apps/admin/src/app/(console)/engine/registry/[id]/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: One entity: golden record with sources, classification, clients, full history; edits.
 * WHERE IT RUNS: on the server; data from lib/engine-data.ts, drawn by components/engine-entity.tsx.
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { EntityView } from "@/components/engine-entity";
import { EngineUnavailable } from "@/components/engine-overview";
import { can, CAN, requireStaff } from "@/lib/auth";
import { categoryOptions, entityDetail } from "@/lib/engine-data";

export const metadata: Metadata = { title: "Entity" };
export const dynamic = "force-dynamic";

export default async function EntityPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff(CAN.engine);
  const { id } = await params;
  let data: Awaited<ReturnType<typeof entityDetail>>;
  let categories: Awaited<ReturnType<typeof categoryOptions>>;
  try {
    [data, categories] = await Promise.all([entityDetail(id), categoryOptions()]);
  } catch (err) {
    return <EngineUnavailable error={err instanceof Error ? err.message : String(err)} />;
  }
  if (!data) notFound();
  return <EntityView d={data} categories={categories} canEdit={can(staff, "engineEdit")} />;
}
