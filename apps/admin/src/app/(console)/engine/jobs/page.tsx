/**
 * FILE: apps/admin/src/app/(console)/engine/jobs/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: "Jobs & schedules": start engine jobs, switch schedules, RCS number space, queue and runs.
 * WHERE IT RUNS: on the server; data from lib/engine-data.ts, drawn by components/engine-jobs.tsx.
 */

import type { Metadata } from "next";
import { EngineJobs } from "@/components/engine-jobs";
import { EngineUnavailable } from "@/components/engine-overview";
import { can, CAN, requireStaff } from "@/lib/auth";
import { jobsPage } from "@/lib/engine-data";

export const metadata: Metadata = { title: "Engine jobs" };
export const dynamic = "force-dynamic";

export default async function EngineJobsPage() {
  const staff = await requireStaff(CAN.engine);
  try {
    return <EngineJobs data={await jobsPage()} canRun={can(staff, "engineJobs")} />;
  } catch (err) {
    return <EngineUnavailable error={err instanceof Error ? err.message : String(err)} />;
  }
}
