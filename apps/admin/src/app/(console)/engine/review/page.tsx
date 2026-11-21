/**
 * FILE: apps/admin/src/app/(console)/engine/review/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The Review page: staging approval gate, match candidates, conflicts, news mentions, rejects.
 *   `?tab=` picks the tab, `?source=` filters the staging queue.
 * WHERE IT RUNS: on the server; data from lib/engine-data.ts reviewPage(), drawn by components/engine-review.tsx.
 */

import type { Metadata } from "next";
import { EngineUnavailable } from "@/components/engine-overview";
import { ReviewView } from "@/components/engine-review";
import { can, CAN, requireStaff } from "@/lib/auth";
import { reviewPage } from "@/lib/engine-data";

export const metadata: Metadata = { title: "Review" };
export const dynamic = "force-dynamic";

export default async function ReviewPage({ searchParams }: { searchParams: Promise<{ tab?: string; source?: string }> }) {
  const staff = await requireStaff(CAN.engine);
  const { tab, source } = await searchParams;
  try {
    return <ReviewView data={await reviewPage({ source })} canEdit={can(staff, "engineEdit")} tab={tab} source={source} />;
  } catch (err) {
    return <EngineUnavailable error={err instanceof Error ? err.message : String(err)} />;
  }
}
