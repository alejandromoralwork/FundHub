/**
 * FILE: apps/admin/src/app/(console)/engine/sources/page.tsx
 * PART: console (apps/admin)
 * WHAT IT DOES: The Sources page: source registry, staging review policies, attribute precedence, news feeds.
 * WHERE IT RUNS: on the server; data from lib/engine-data.ts sourcesPage(), drawn by components/engine-sources.tsx.
 */

import type { Metadata } from "next";
import { EngineUnavailable } from "@/components/engine-overview";
import { SourcesView } from "@/components/engine-sources";
import { can, CAN, requireStaff } from "@/lib/auth";
import { sourcesPage } from "@/lib/engine-data";

export const metadata: Metadata = { title: "Sources" };
export const dynamic = "force-dynamic";

export default async function SourcesPage() {
  const staff = await requireStaff(CAN.engine);
  try {
    return <SourcesView data={await sourcesPage()} canEdit={can(staff, "engineEdit")} />;
  } catch (err) {
    return <EngineUnavailable error={err instanceof Error ? err.message : String(err)} />;
  }
}
