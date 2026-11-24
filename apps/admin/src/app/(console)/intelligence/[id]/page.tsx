/**
 * FILE: apps/admin/src/app/(console)/intelligence/[id]/page.tsx
 * PART: console (apps/admin) — Data intelligence
 * WHAT IT DOES: One report, embedded: checks that the dashboard is in the embeddable list (and, if restricted, that
 *   the viewer may see it), signs a 10-minute embed address, records the view in the audit log.
 * WHERE IT RUNS: on the server; the iframe is drawn by components/bi-views.tsx.
 * FRAMEWORK NOTES: `params` is a Promise in this Next.js version (await it).
 */

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BiDashboardView, BiNotConfigured } from "@/components/bi-views";
import { audit } from "@/lib/audit";
import { CAN, can, requireStaff } from "@/lib/auth";
import { editUrl, embedUrl, listDashboards, missingConfig } from "@/lib/metabase";

export const metadata: Metadata = { title: "Report" };
export const dynamic = "force-dynamic";

export default async function IntelligenceReportPage({ params }: { params: Promise<{ id: string }> }) {
  const staff = await requireStaff(CAN.bi);
  const missing = missingConfig();
  if (missing.length) return <BiNotConfigured missing={missing} />;
  const id = Number((await params).id);
  if (!Number.isInteger(id) || id <= 0) notFound();
  // Only dashboards someone deliberately made embeddable can be shown, never any id typed in the address bar.
  const d = (await listDashboards()).find((x) => x.id === id);
  if (!d || (d.kind === "restricted" && !can(staff, "biRestricted"))) notFound();
  await audit(staff, "bi.view", "metabase_dashboard", id, { name: d.name });
  return <BiDashboardView name={d.name} description={d.description} kind={d.kind} src={embedUrl(id)} editUrl={editUrl(id)} />;
}
