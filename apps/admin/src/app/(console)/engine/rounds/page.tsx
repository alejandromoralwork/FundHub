/**
 * FILE: apps/admin/src/app/(console)/engine/rounds/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The register of capture rounds (initial and monthly update passes over RCS companies) and the
 *   companies of one round (?id=…&status=…). Start / close / reset-skipped for CAN.engineJobs.
 * WHERE IT RUNS: on the server; data from lib/engine-data.ts, drawn by components/engine-rounds.tsx.
 */

import type { Metadata } from "next";
import { EngineUnavailable } from "@/components/engine-overview";
import { RoundsView } from "@/components/engine-rounds";
import { can, CAN, requireStaff } from "@/lib/auth";
import { roundsPage } from "@/lib/engine-data";

export const metadata: Metadata = { title: "Capture rounds" };
export const dynamic = "force-dynamic";

export default async function RoundsPage({ searchParams }: { searchParams: Promise<{ id?: string; status?: string }> }) {
  const staff = await requireStaff(CAN.engine);
  const { id, status } = await searchParams;
  try {
    return <RoundsView data={await roundsPage(Number(id) || undefined, status)} canEdit={can(staff, "engineJobs")} status={status} />;
  } catch (err) {
    return <EngineUnavailable error={err instanceof Error ? err.message : String(err)} />;
  }
}
