import type { Metadata } from "next";
import { DashboardView } from "@/components/dashboard-view";
import { requireStaff } from "@/lib/auth";
import { getDashboard } from "@/lib/metrics";

export const metadata: Metadata = { title: "Dashboard" };

export default async function DashboardPage({ searchParams }: { searchParams: Promise<{ denied?: string }> }) {
  const staff = await requireStaff();
  const [data, { denied }] = await Promise.all([getDashboard(), searchParams]);
  return <DashboardView data={JSON.parse(JSON.stringify(data))} staffName={staff.name.split(" ")[0]!} denied={denied === "1"} />;
}
