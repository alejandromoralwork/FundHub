/**
 * FILE: apps/admin/src/app/(console)/engine/quality/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The Data quality page: latest value of every check, 90-day trend, golden-record completeness.
 * WHERE IT RUNS: on the server; data from lib/engine-data.ts qualityPage(), drawn by components/engine-quality.tsx.
 */

import type { Metadata } from "next";
import { EngineUnavailable } from "@/components/engine-overview";
import { QualityView } from "@/components/engine-quality";
import { CAN, requireStaff } from "@/lib/auth";
import { qualityPage } from "@/lib/engine-data";

export const metadata: Metadata = { title: "Data quality" };
export const dynamic = "force-dynamic";

export default async function QualityPage() {
  await requireStaff(CAN.engine);
  try {
    return <QualityView data={await qualityPage()} />;
  } catch (err) {
    return <EngineUnavailable error={err instanceof Error ? err.message : String(err)} />;
  }
}
