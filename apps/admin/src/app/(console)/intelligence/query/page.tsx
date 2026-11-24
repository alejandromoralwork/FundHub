/**
 * FILE: apps/admin/src/app/(console)/intelligence/query/page.tsx
 * PART: console (apps/admin) — Data intelligence
 * WHAT IT DOES: The query workspace: links into Metabase's SQL editor, question builder, dashboards and the
 *   Team reports collection (Metabase's editor cannot be embedded with the free edition, so it opens in a tab).
 * WHERE IT RUNS: on the server; drawn by components/bi-views.tsx.
 */

import type { Metadata } from "next";
import { BiWorkspace } from "@/components/bi-views";
import { CAN, requireStaff } from "@/lib/auth";
import { metabaseUrl } from "@/lib/metabase";

export const metadata: Metadata = { title: "Query workspace" };

export default async function QueryWorkspacePage() {
  await requireStaff(CAN.bi);
  const base = metabaseUrl();
  return <BiWorkspace metabaseUrl={base} teamCollectionUrl={`${base}/collection/root`} />;
}
