import type { Metadata } from "next";
import { AnalyticsView } from "@/components/analytics-view";
import { requireStaff } from "@/lib/auth";
import { getAnalytics } from "@/lib/metrics";

export const metadata: Metadata = { title: "Analytics" };

export default async function AnalyticsPage() {
  await requireStaff();
  const data = await getAnalytics();
  return <AnalyticsView data={JSON.parse(JSON.stringify(data))} posthogUrl={process.env.POSTHOG_URL ?? null} />;
}
