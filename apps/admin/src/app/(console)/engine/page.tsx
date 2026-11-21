/**
 * FILE: apps/admin/src/app/(console)/engine/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The Company Intelligence "Pipeline" page: KPIs, the interactive dataflow diagram (sources → raw →
 *   staging → approval gate → clean → match → golden → publish), coverage, completeness, quality, operations.
 * WHERE IT RUNS: on the server (React Server Component); data from lib/engine-data.ts, drawn by
 *   components/engine-pipeline.tsx.
 */

import type { Metadata } from "next";
import { EngineUnavailable } from "@/components/engine-overview";
import { PipelineView } from "@/components/engine-pipeline";
import { CAN, requireStaff } from "@/lib/auth";
import { currentRound, pipelineOverview } from "@/lib/engine-data";

export const metadata: Metadata = { title: "Intelligence pipeline" };
// Always fresh: the pipeline runs in the background.
export const dynamic = "force-dynamic";

export default async function PipelinePage() {
  await requireStaff(CAN.engine);
  try {
    const [data, round] = await Promise.all([pipelineOverview(), currentRound()]);
    return <PipelineView data={data} round={round} />;
  } catch (err) {
    return <EngineUnavailable error={err instanceof Error ? err.message : String(err)} />;
  }
}
