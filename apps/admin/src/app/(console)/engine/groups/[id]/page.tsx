/**
 * FILE: apps/admin/src/app/(console)/engine/groups/[id]/page.tsx
 * PART: console (apps/admin) — Company intelligence → Groups
 * WHAT IT DOES: One company group: path, parent, sub-groups, members; staff edits for CAN.engineEdit.
 * WHERE IT RUNS: on the server; data from lib/engine-data.ts groupDetail(), drawn by components/engine-groups.tsx.
 * FRAMEWORK NOTES: `params` is a Promise in this Next.js version (await it).
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GroupDetailView } from "@/components/engine-groups";
import { EngineUnavailable } from "@/components/engine-overview";
import { CAN, can, requireStaff } from "@/lib/auth";
import { groupDetail } from "@/lib/engine-data";

export const metadata: Metadata = { title: "Company group" };
export const dynamic = "force-dynamic";

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff(CAN.engine);
  const id = Number((await params).id);
  let d;
  try {
    d = await groupDetail(id);
  } catch (err) {
    return <EngineUnavailable error={err instanceof Error ? err.message : String(err)} />;
  }
  if (!d) notFound();
  return <GroupDetailView d={d} canEdit={can(staff, "engineEdit")} />;
}
