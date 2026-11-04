/**
 * FILE: apps/admin/src/app/(console)/engine/matches/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: Match review: possible duplicates (same name, no shared identifier) to merge or keep apart.
 * WHERE IT RUNS: on the server; data from lib/engine-data.ts, drawn by components/engine-matches.tsx.
 */

import type { Metadata } from "next";
import { MatchesView } from "@/components/engine-matches";
import { EngineUnavailable } from "@/components/engine-overview";
import { can, CAN, requireStaff } from "@/lib/auth";
import { pendingMatches } from "@/lib/engine-data";

export const metadata: Metadata = { title: "Match review" };
export const dynamic = "force-dynamic";

export default async function MatchesPage() {
  const staff = await requireStaff(CAN.engine);
  try {
    return <MatchesView rows={await pendingMatches()} canEdit={can(staff, "engineEdit")} />;
  } catch (err) {
    return <EngineUnavailable error={err instanceof Error ? err.message : String(err)} />;
  }
}
