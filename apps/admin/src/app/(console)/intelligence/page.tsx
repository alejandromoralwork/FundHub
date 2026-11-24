/**
 * FILE: apps/admin/src/app/(console)/intelligence/page.tsx
 * PART: console (apps/admin) — Data intelligence
 * WHAT IT DOES: The report catalogue: every Metabase dashboard with embedding on, system reports first. Restricted
 *   (finance) reports are listed only for roles in CAN.biRestricted.
 * WHERE IT RUNS: on the server; data from src/lib/metabase.ts, drawn by components/bi-views.tsx.
 */

import type { Metadata } from "next";
import { BiCatalogue, BiNotConfigured, type BiCard } from "@/components/bi-views";
import { CAN, can, requireStaff } from "@/lib/auth";
import { listDashboards, metabaseUrl, missingConfig } from "@/lib/metabase";

export const metadata: Metadata = { title: "Data intelligence" };
export const dynamic = "force-dynamic";

export default async function IntelligencePage() {
  const staff = await requireStaff(CAN.bi);
  const missing = missingConfig();
  if (missing.length) return <BiNotConfigured missing={missing} />;
  let dashboards: BiCard[] = [];
  let error: string | undefined;
  try {
    dashboards = (await listDashboards()).filter((d) => d.kind !== "restricted" || can(staff, "biRestricted"));
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
  }
  return <BiCatalogue dashboards={dashboards} metabaseUrl={metabaseUrl()} error={error} />;
}
