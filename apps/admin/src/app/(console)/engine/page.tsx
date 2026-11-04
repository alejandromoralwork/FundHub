/**
 * FILE: apps/admin/src/app/(console)/engine/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The Scraping Engine overview page (census, coverage, RCS session, queue, runs, change feed).
 * WHERE IT RUNS: on the server (React Server Component); data from lib/engine-data.ts, drawn by
 *   components/engine-overview.tsx.
 */

import type { Metadata } from "next";
import { EngineOverview, EngineUnavailable } from "@/components/engine-overview";
import { CAN, requireStaff } from "@/lib/auth";
import { engineDashboard } from "@/lib/engine-data";

export const metadata: Metadata = { title: "Scraping engine" };
// Always fresh: the engine changes in the background.
export const dynamic = "force-dynamic";

export default async function EnginePage() {
  await requireStaff(CAN.engine);
  try {
    return <EngineOverview data={await engineDashboard()} />;
  } catch (err) {
    return <EngineUnavailable error={err instanceof Error ? err.message : String(err)} />;
  }
}
