/**
 * FILE: apps/admin/src/app/(console)/engine/groups/page.tsx
 * PART: console (apps/admin) — Company intelligence → Groups
 * WHAT IT DOES: Company groups by layer (corporate, fund structures, service providers) as a searchable tree.
 * WHERE IT RUNS: on the server; data from lib/engine-data.ts groupsPage(), drawn by components/engine-groups.tsx.
 * FRAMEWORK NOTES: `searchParams` is a Promise in this Next.js version (await it).
 */

import type { Metadata } from "next";
import { GroupsView } from "@/components/engine-groups";
import { EngineUnavailable } from "@/components/engine-overview";
import { CAN, requireStaff } from "@/lib/auth";
import { groupsPage, type GroupFilters } from "@/lib/engine-data";

export const metadata: Metadata = { title: "Company groups" };
export const dynamic = "force-dynamic";

export default async function GroupsPage({ searchParams }: { searchParams: Promise<GroupFilters> }) {
  await requireStaff(CAN.engine);
  const filters = await searchParams;
  try {
    return <GroupsView page={await groupsPage(filters)} filters={filters} />;
  } catch (err) {
    return <EngineUnavailable error={err instanceof Error ? err.message : String(err)} />;
  }
}
